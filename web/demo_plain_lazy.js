define([
  'lib/auxiliary/assert',
  'lib/lazy_scroll',
], function(assert, lazy_scroll) { "use strict";

/* global console, $ */

var $scope = { on: function() {} };

var item = function(i) {
    var html =
            '<div class="item" id="item_' + i + '" style="top: 0; position: absolute;">' +
               '<p>This is item ' + i + '</p>';
    if (i % 4 === 0) {
        html += '<p>Some items have extra stuff</p>';
    }
    if (i % 7 === 0) {
        html += '<p>Some items have even more extra stuff</p>';
    }
    html += '</div>';
    return $(html)[0];
};

var count = 100000;

var lister = {
    count: function() { return count; },
    item: item,
};

var container = $("#main");

var options = {};

var scroll_instance = lazy_scroll.create_with_div($scope, lister, container, options);

var resize = function() {
    $("#main")[0].style.height = "" + (window.innerHeight - 100) + "px";
    scroll_instance.recreate();
};

resize();

window.addEventListener("resize", resize);

var pos = 0.0;
var incr = 0.01;

var check_positions = function() {
    var items = $(".item");
    var poss = [];
    for (var i = 0; i < items.length; i++) {
        var h = items[i].offsetHeight;
        var tr = items[i].style['-webkit-transform'];
        var top = parseInt(tr.substr("translate3d(0px, ".length), 10);
        if (top > -100) {
            poss.push([top, h]);
            var item_i = parseInt(items[i].getAttribute("id").substr("item_".length), 10);
            var node = scroll_instance.lazy_scroll.root.node_by_lister_i(item_i);
            assert(h == scroll_instance.lazy_scroll.height_cache[item_i], node);
        }
    }
    if (poss.length === 0) return;
    poss.sort(function(a, b) { return a[0] - b[0]; });

    var should_be = poss[0][0];
    for (i = 0; i < poss.length; i++) {
        assert(Math.abs(poss[i][0] - should_be) < 1);
        should_be += poss[i][1];
    }
};

var test_step = function() {
    if (scroll_instance.lazy_scroll.rendering()) return;

    try {
        assert(scroll_instance.lazy_scroll.height_queue.length === 0);
        check_positions();
    } catch(e) {
        /* jshint debug: true */
        debugger;
    }
    pos = pos + incr;
    if (pos >= 1) {
        pos = 1;
        incr = -1 * incr;
    } else if (pos <= 0) {
        pos = 0;
        pos = -1 * Math.random();
    }
    console.log("POS", pos);
    var H = scroll_instance.lazy_scroll.getHeight();
    $("#main").scrollTop(Math.abs(pos) * H);
};

var id;
var start_test = function() {
    $("#test").click(stop_test);
    $("#test").text("Stop test");
    if (! id) {
        id = window.setInterval(test_step, 200);
    }
};
var stop_test = function() {
    if (id) {
        window.clearInterval(id);
        id = null;
    }
    $("#test").click(start_test);
    $("#test").text("Start scroll test");
};

stop_test();

});
