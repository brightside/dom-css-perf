// Touch-event handling for programmatic scrolling.
//
// Includes fastclick -like click generation and highlighting and
// support for pull-to-refresher.
//
// Meant to be hooked up to a zynga scroller.
//
// See also lib/scroller.js for using this with a single content
// element to be scrolled.
//
// TODO: move the refresher support out of this module and into
// lib/scroller.js

define(function(imp) { "use strict";

var module = {};

// Assumptions that maybe should be parametrized
var REFRESHER_SIZE = 80;

// Maximum distance user can move their finger or sroll
// content before we reset the click target.
var RESET_DIST = 30;

var DEBUG = function() {
    // console.log.apply(console, arguments);
};

var dist = function(xy0, xy1) {
    var xd = xy0[0] - xy1[0];
    var yd = xy0[1] - xy1[1];
    return Math.sqrt(xd*xd + yd*yd);
};

module.hook_scroller = function(scope, events_on, scrollerController, zscroller, inner_render) {
    if (!events_on) {
        throw new Error("must have events_on");
    }

    var events_on_not_svg = events_on.namespaceURI !== "http://www.w3.org/2000/svg";

    // Slightly delayed highlighter with reset.
    var highlight = {
        elem: null,
        timer: null,
        set: function(elem) {
            var self = this;
            self.reset();
            if (!elem) return;
            self.timer = window.setTimeout(function() {
                self.elem = elem;
                elem.style['background-color'] = "#d9d9d9";
                self.timer = null;
            }, 20);
        },
        reset: function() {
            if (this.elem) {
                this.elem.style['background-color'] = 'white';
            }
            if (this.timer) {
                window.clearTimeout(this.timer);
            }
            this.timer2 = null;
            this.elem = null;
        },
    };
    // Click candidate element
    var click = {
        elem: null,
        x: 0,
        y: 0,
        set: function(elem, ev) {
            this.reset();
            DEBUG("click.set", elem, ev);
            this.elem = elem;
            if (ev.targetTouches && ev.targetTouches[0]) {
                this.x = ev.targetTouches[0].clientX;
                this.y = ev.targetTouches[0].clientY;
            } else {
                this.x = ev.clientX;
                this.y = ev.clientY;
            }
        },
        get: function() {
            return this.elem;
        },
        trigger: function() {
            var self = this;
            var elem = self.elem;
            if (!elem) { return; }
            self.elem = null;
            var clickEvent = document.createEvent('MouseEvents');
            clickEvent.initMouseEvent('click', true, true, window, 1, 0, 0, self.x, self.y,
                                      false, false, false, false, 0, null);
            elem.dispatchEvent(clickEvent);
            window.setTimeout(function() { highlight.reset(); }, 500);
        },
        reset: function() {
            DEBUG("click.reset");
            this.elem = null;
        },
    };

    var BsideScroller = function() {
        var self = this;
        self.container = events_on;
        self.scroller = zscroller;

        // State for handling events
        // scroll position at touchstart, used to reset the click
        // element if the user scrolls
        var start_scroll_pos = [0, 0];
        // Coordinates of the touchstart event, used to reset the
        // click element if the user moves their finger.
        var start_event_pos = [0, 0];
        // Last-seen scroll position, used for initializing start_scroll_pos
        var last_scroll_pos = [0, 0];
        // Time of the last scroll update, used to detect that touchstart
        // was used to stop scrolling
        var last_scroll_time;
        // Whether the user is currently touching. Used to start the refresher
        // either on touchend if already scrolled into view or directly when
        // scrolled into view if no longer touching.
        self.is_touching = false;
        // Which form element the touchstart was on (we should not preventDefault
        // on touchstart events on form elements and should thus preventDefault
        // on touchmove afterwards to not have the browser scroll).
        var on_form_element;

        // Height we want to give to the refresh element, either 0 or
        // REFRESHER_SIZE
        self.refresher_height = 0;

        if (scrollerController) {
            scrollerController.done = function() {
                // Would be nice to animate the refresher away, but this
                // doesn't work for some reason (not diagnosed).
                self.refresher_height = 0;
                var top = self.scroller.getValues().top;
                self.scroller.scrollTo(0, top + 1, true);
            };
        }

        // public scrollTop function to be used through
        // scope.scroller.scrollTop
        self.scrollTop = function(param) {
            if (param === undefined || param === null) {
                return self.scroller.getValues().top;
            } else {
                self.scroller.scrollTo(0, param, true);
            }
        };
        self.setDimensions = function(a, b, c, d) {
            click.reset();
            highlight.reset();
            return self.scroller.setDimensions(a, b, c, d);
        };
        self.setPosition = function(x, y) {
            return self.scroller.setPosition(x, y);
        };
        self.scrollTo = function(x, y, animate, zoom) {
            return self.scroller.scrollTo(x, y, animate, zoom);
        };
        self.zoomTo = function(level) {
            return self.scroller.zoomTo(level);
        };
        self.getValues = function() {
            return self.scroller.getValues();
        };
        // Callback from zynga scroller
        //
        var last_left = -1, last_top = -1, last_zoom = 1;
        self.render = function(left, top, zoom) {
            DEBUG("render", left, top, zoom);
            // Somehow it's possible to get the container to scroll, which
            // results in completely wrong rendering. Check and reset here.
            if (self.container.scrollTop > 1) {
                self.container.scrollTop = 1;
            }

            if (Math.abs(last_left - left) < 0.01 &&
                Math.abs(last_top - top) < 0.01 &&
                Math.abs(last_zoom - zoom) < 0.001) {
                return;
            }
            last_left = left; last_top = top; last_zoom = zoom;
            // Click state handling
            last_scroll_time = (new Date()).getTime();
            last_scroll_pos = [left, top];
            if (dist(start_scroll_pos, last_scroll_pos) > RESET_DIST) {
                click.reset();
                highlight.reset();
            }

            // Check if we've pulled the refresher into view
            if (scrollerController && top < -1 * REFRESHER_SIZE && self.refresher_height === 0) {
                self.refresher_height = REFRESHER_SIZE;
                if (scrollerController.activate) {
                    scrollerController.activate();
                }
                if (!self.is_touching) {
                    if (scrollerController.start) {
                        scrollerController.start();
                    } else {
                        self.refresher_height = 0;
                    }
                }
            }

            inner_render(left, top, zoom);
        };

        // Event handlers
        var touchStart = function(e) {
            var was_scrolling = (e.timeStamp - last_scroll_time < 50);
            self.is_touching = true;
            on_form_element = null;
            DEBUG("touchstart", was_scrolling, e);
            self.scroller.doTouchStart(e.touches, e.timeStamp);
            if (!was_scrolling) {
                // Don't react if initial down happens on a form element
                if (e.touches[0] && e.touches[0].target &&
                    e.touches[0].target.tagName.match(/input|textarea|select/i)) {
                    DEBUG("touchstart on form element");
                    on_form_element = e.touches[0].target;
                    return;
                }
                var elem = e.touches[0].target;
                e.preventDefault();
                if (elem) {
                    start_scroll_pos = [ last_scroll_pos[0], last_scroll_pos[1] ];
                    if (e.touches && e.touches[0]) {
                        start_event_pos = [ e.touches[0].pageX, e.touches[0].pageY ];
                    }
                    if (events_on_not_svg) {
                        // Walk the tree up from the element self got hit for two reasons:
                        // 1. Highlight elements if they want to be highlighted
                        // 2. If the hit happened to be on an svg element of some kind,
                        //    store the svg's html parent node as the click target, as
                        //    clicks don't bubble up through svg.
                        for (var i = elem; i; i = i.parentNode) {
                            if (i.tagName && i.tagName.match && i.tagName.match(/svg/)) {
                                click.reset();
                            } else if (!click.get()) {
                                click.set(i, e);
                            }
                            if (i.hasAttribute && i.hasAttribute('highlight')) {
                                highlight.set(i);
                            }
                        }
                    } else {
                        click.set(elem, e);
                    }
                } else {
                    DEBUG("no target element");
                }
            } else {
                click.reset();
                e.preventDefault();
                e.stopPropagation();
            }
        };

        self.container.addEventListener("touchstart", touchStart, false);
        self.container.addEventListener("mousedown", function(e) {
            e.touches = [ { pageX: e.pageX, pageY: e.pageY } ];
            return touchStart(e);
        }, false);
        self.container.addEventListener("mousewheel", function(e) {
            if (self.scroller.options.zooming) {
                DEBUG("mousewheel", e);
                self.scroller.doMouseZoom(-1 * e.wheelDelta, e.timeStamp, e.pageX, e.pageY);
                e.preventDefault();
                e.stopPropagation();
            }
        });

        var addScopedListener = function(object) {
            return function(name, listener) {
                object.addEventListener(name, listener, false);
                scope.$on('$destroy', function() {
                    object.removeEventListener(name, listener);
                });
            };
        };
        var addDocumentListener = addScopedListener(document);
        var touchMove = function(e) {
            DEBUG("touchmove", e, self.is_touching);
            if (!self.is_touching) return;
            self.scroller.doTouchMove(e.touches, e.timeStamp, e.scale);
            if (on_form_element) {
                // Since we didn't preventDefault the touchstart when on a form
                // element, we must preventDefault here so that the browser
                // doesn't get to scroll the whole page.
                e.preventDefault();
                return false;
            }
            var event_pos = [0, 0];
            if (e.touches && e.touches[0]) {
                event_pos = [ e.touches[0].pageX, e.touches[0].pageY ];
            }
            if (dist(start_event_pos, event_pos) > RESET_DIST) {
                DEBUG("touchmove", "moved");
                click.reset();
                highlight.reset();
            }
        };
        addDocumentListener("touchmove", touchMove);
        addDocumentListener("mousemove", function(e) {
            e.touches = [ { pageX: e.pageX, pageY: e.pageY } ];
            return touchMove(e);
        });

        var onBlur = function() {
            DEBUG("blur");
            window.scrollTo(0, 1);
            window.scrollTo(0, 0);
        };
        var touchEnd = function(e) {
            DEBUG("touchend", e, click);
            if (!self.is_touching) return;
            self.is_touching = false;
            if (scrollerController && self.refresher_height !== 0) {
                if (scrollerController.start) {
                    scrollerController.start();
                } else {
                    self.refresher_height = 0;
                }
            }
            if (on_form_element) {
                // Input elements may scroll the address bar into view, which
                // will result in an offset in our scrolling - scroll the
                // address bar back off after done with the element.
                // TODO: remove event listener
                on_form_element.addEventListener("blur", onBlur, false);
            }
            on_form_element = null;
            self.scroller.doTouchEnd(e.timeStamp);
            click.trigger();
        };
        addDocumentListener("touchend", touchEnd);
        addDocumentListener("mouseup", touchEnd);

        var touchCancel = function(e) {
            DEBUG("touchcancel", e, self.is_touching);
            if (!self.is_touching) return;
            self.is_touching = false;
            on_form_element = null;
            highlight.reset();
            self.scroller.doTouchEnd(e.timeStamp);
        };
        addDocumentListener("touchcancel", touchCancel);
        addDocumentListener("mouseout", function(e) {
            if (e.toElement === null && e.relatedTarget === null) {
                return touchCancel(e);
            }
        });

        self.cancel = function() {
            var now = new Date();
            touchCancel({ timeStamp: now.getTime() });
        };
    };

    return new BsideScroller();
};

return module;

});
