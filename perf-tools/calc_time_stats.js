#!/usr/bin/env node
// calc_time_stats.js: calculate rendering timing statistics from log file
//                     generated by time_list.js
// Usage:
//     calc_time_stats.js <log file name>
//

/* jslint node:true */

var logfilename = process.argv[2] || 'log';
var fs = require('fs');
var str = fs.readFileSync(logfilename, 'utf8');
var items = JSON.parse('[' + str + ' {} ]');
var _ = require('underscore');

var n = 0.0;
var total_times = {
    'ForcedLayout' : 0.0,
    'ForcedRecalculateStyles' : 0.0,
    'ParseHTML' : 0.0,
    'Layout' : 0.0,
    'RecalculateStyles' : 0.0,
    'Paint' : 0.0,
    'EventDispatch' : 0.0,
    'TimerFire' : 0,
    'FunctionCall' : 0,
    'AllJS' : 0,
    'all': 0.0
};
var total_times_sq = _.clone(total_times);
var times = _.clone(total_times);
var avg_times = _.clone(total_times);
var counts = {
    'ForcedLayout' : 0,
    'ForcedRecalculateStyles' : 0,
    'ParseHTML' : 0,
    'Layout' : 0,
    'RecalculateStyles' : 0,
    'Paint' : 0,
    'EventDispatch' : 0,
    'TimerFire' : 0,
    'FunctionCall' : 0,
};
var total_counts = _.clone(counts);
var total_counts_sq = _.clone(counts);
var avg_counts = _.clone(total_counts);

// skip first ones for possible app cache reload
var seen = 0;

function clear_all(times) {
    for (var k in times) {
        times[k] = 0.0;
    }
}

function add_to_totals(times, total_times, total_times_sq) {
    times.AllJS = 0;
    times.AllJS = (times.EventDispatch + times.TimerFire + times.FunctionCall);
    for (var i in times) {
        total_times[i] += times[i];
        total_times_sq[i] += times[i] * times[i];
        times[i] = 0;
    }
}

var reset = function() {
    if (times.all < 0.01) {
        return;
    }
    if (seen < 2) {
        clear_all(times);
        clear_all(counts);
        seen++;
        return;
    }
    // console.log(times);
    // console.log(counts);
    n = n + 1;
    add_to_totals(times, total_times, total_times_sq);
    add_to_totals(counts, total_counts, total_counts_sq);
};

var handle_subitem = function(item) {
    if (typeof item === "object") {
        var t = item.type;
        var elapsed;
        if (t === 'RecalculateStyles' ||
            t === 'Layout') {
            t = 'Forced' + t;
            if (item.stackTrace && item.stackTrace.length > 0) {
                console.log(t + ", trace:");
                (item.stackTrace || []).forEach(function(i) {
                    console.log(i.functionName + " " + i.url + ":" + i.lineNumber);
                });
            }
            elapsed = item.endTime - item.startTime;
            times[t] += elapsed;
            counts[t]++;
        } else if (t === 'ParseHTML') {
            elapsed = item.endTime - item.startTime;
            times[t] += elapsed;
            counts[t]++;
        } else {
            (item.children || []).forEach(function(i) {
                handle_subitem(i);
            });
        }
    }
};

var handle_item = function(item) {
    if (typeof item === "object") {
        var t = item.type;
        if (t === 'Layout' ||
            t === 'RecalculateStyles' ||
            t === 'Paint' ||
            t === 'EventDispatch' ||
            t === 'TimerFire' ||
            t === 'FunctionCall') {
            var elapsed = item.endTime - item.startTime;
            times[t] += elapsed;
            counts[t]++;
            times.all += elapsed;
            item.children.forEach(function(i) {
                handle_subitem(i);
            });
            // console.log("%s elapsed %s ms", t, elapsed);
        } else {
            var method = item.method;
            if (method === 'Timeline.stop') {
                reset();
            } else {
                for (var i in item) {
                    handle_item(item[i]);
                }
            }
        }
    }
};

for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (item['0'] === "recv" || item['0'] === "send") {
        handle_item(JSON.parse(item['1']));
    }
}

reset();

var round = function(v) {
    return v.toFixed(2);
};

for (var i in total_times) {
    var sum = total_times[i];
    var sqsum = total_times_sq[i];
    var avg = sum / n;
    var variance = (sqsum - ((sum * sum) / n)) / (n - 1);
    console.log(i, sum, sqsum, variance, n);
    avg_times[i] = "" + round(avg, 2) + " +/- " + round(2 * Math.sqrt(variance), 2);
}

for (var i in avg_counts) {
    var sum = total_counts[i];
    var sqsum = total_counts_sq[i];
    var avg = sum / n;
    var variance = (sqsum - ((sum * sum) / n)) / (n - 1);
    avg_counts[i] = "" + round(avg, 2) + " +/- " + round(2 * Math.sqrt(variance), 2);
}
console.log("n %d", n);
console.log("average times");
console.log(avg_times);
console.log("average counts");
console.log(avg_counts);
