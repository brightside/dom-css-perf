#!/usr/bin/env node
// time_list.js : get rendering timings for a page
//
// Usage:
//   ./time_list.js [--port=<remote debugger port>] \
//       --base_url=<base_url> \
//       [--setup_path=<first url to visit>]
//       --start_path=<url to visit before test page>
//       --test_path=<url to measure performance on>
//
// requires:
//   from node: ws
//   from homebrew: ios-webkit-debug-proxy
//
// For the protocol, see
// See https://developers.google.com/chrome-developer-tools/docs/debugger-protocol
//
// TODO:
//     factor out the functionality

/* jslint node:true */

var script_start_time = Date.now();

function current_time() {
    return Date.now() - script_start_time;
}

var log = function() {
    console.log(JSON.stringify(arguments) + ", ");
};

var argv = require('optimist').argv;

var start_path = argv.start_path;
var test_path = argv.test_path;
var setup_path = argv.setup_path;
var base_url = argv.base_url;
var port = argv.port;
var time_factor = parseFloat(argv.time_factor || 1);

log("Testing page", test_path);

var ws;

var child_process = require('child_process');
var proxy;

if (! port) {
    port = 9222;
    proxy = child_process.spawn('ios_webkit_debug_proxy');
    proxy.stdout.on('data', function(data) {
        log('proxy.stdout', data.toString());
    });
    proxy.stderr.on('data', function(data) {
        log('proxy.stderr', data.toString());
    });
    proxy.on('error', function(err) {
        console.log('proxy.error', err);
        process.exit(3);
    });
}

var die = function(exit_code) {
    if (proxy) proxy.kill();
    process.exit(exit_code);
};

process.on('uncaughtException', function(err) {
    log('uncaughtException');
    console.log(err);
    console.log(err.stack);
    if (ws) ws.close();
    die(2);
});

process.on('SIGINT', function() {
    log('sigint');
    if (ws) ws.close();
    die(1);
});


var connect = function(url) {
    var commands = [
        // TODO: seems that .id is overwritten as command_ix. Is it needed for proxy or just for
        //       our internal book-keeping?
        {"id": 1, "method": "Timeline.stop", "params": { "maxCallStackDepth": 3 } },
        {"id": 2, "method": "Page.navigate", "params":{"url": base_url + start_path } },
        {"id": 11, "method": "Timeline.start", "params": { "maxCallStackDepth": 10 } },
        {"id": 12, "method": "Page.navigate", "params":{"url": base_url + test_path } },
    ];
    var waits = [100, 2000, 300, 3000];
    waits = waits.map(function(w) { return w * time_factor; });
    var iteration_wait = 1000; // a bit of extra wait time on the top of command wait times
    for (var i in waits) { iteration_wait += waits[i]; }


    var iterations = 8;
    var iteration_ix = 0;

    log('open', url, current_time());
    var WebSocket = require('ws');
    ws = new WebSocket(url);
    var command_ix = 1;

    var send_next = function() {
        var cmd = commands[command_ix];
        if (cmd) {
            cmd.id = command_ix;
            var str = JSON.stringify(cmd);
            log('send', str, current_time());
            ws.send(str);
        }
    };
    var send_setup = function() {
        if (setup_path) {
            var cmd = { id: 1000, method: "Page.navigate", params: { url: base_url + setup_path } };
            var str = JSON.stringify(cmd);
            log('send', str, current_time());
            ws.send(str);
        } else {
            send_next();
        }
    };
    ws.on('open', function() {
        log('connected', current_time());
        send_setup();
    });
    ws.on('error', function(err) {
        log('error %s', err, current_time());
    });

    ws.on('close', function() {
        log('disconnected', current_time());
        ws.close();
    });

    var iterate = function(iterate) {
        if (++iteration_ix === iterations) {
            log("done", iteration_ix, current_time());
            ws.close();
            die(0);
        } else {
            log("iteration", iteration_ix, current_time());
            command_ix = iteration_ix === 1 ? 1 : 0;
            send_next();
            setTimeout(function() { iterate(iterate); }, iteration_wait);
        }
    };
    setTimeout(function() { iterate(iterate); }, iteration_wait);

    ws.on('message', function(data /*, flags */) {
        log('recv', data, current_time());
        var response = JSON.parse(data);
        if (response.result && response.id == command_ix) {
            command_ix++;
            if (command_ix < commands.length) {
                setTimeout(send_next, waits[command_ix - 1]);
            }
        }
    });
};

var retries = 0;
var http = require('http');
var start = function(start) {
    var on_pages = function(response) {
        var body = '';
        response.on('data', function(chunk) {
            body += chunk;
        });
        response.on('end', function() {
            log('pages', body, current_time());
            var pages = JSON.parse(body);
            if (!pages || pages.length === 0) {
                if (++retries === 20) {
                    log('err', "no pages for debugger, is Safari running?");
                    die(4);
                } else {
                    log('warning', 'no pages yet');
                    setTimeout(function() { start(start); }, 300);
                }
            } else {
                var url = pages[0].webSocketDebuggerUrl;
                connect(url);
            }
        });
    };

    var request = http.request({ 'host': 'localhost',
                                 'path': '/json',
                                 'port': port,
                                 'method': 'GET' },
                                 on_pages);

    request.on('error', function(e) {
        if (++retries == 20) {
            log('err', "couldn't connect to proxy's http server", e);
            die(5);
        } else {
            log("warning", "couldn't connect to proxy's http server yet", e);
            setTimeout(function() { start(start); }, 300);
        }
    });
    request.end();

};

setTimeout(function() { start(start); }, 300);
