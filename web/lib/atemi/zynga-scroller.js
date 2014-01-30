define([
    'vendor/zynga-scroller-a44d7c2/src/Animate',
    'vendor/zynga-scroller-a44d7c2/src/Scroller',
], function() { 'use strict';
    /* global Scroller:true */

    var module = {};
    // check for non-browser env
    if (typeof Scroller !== "undefined") {
        module.Scroller =  Scroller;
        Scroller = undefined;
    }
    // Note that zynga's Animate.js also puts stuff in the global namespaces that
    // Scroller uses at runtime, so can't remove those.
    return module;
});

