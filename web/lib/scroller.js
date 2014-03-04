// Programmatic scrolling.
//
// Includes fastclick -like click generation and highlighting and
// support for pull-to-refresher. On non-touch devices just makes
// sure native scrolling is enabled.
//
// Implemented using zynga scroller,
// https://github.com/zynga/scroller
//
// See also lib/scroller_base.js
//
// Rationale:
// - fastclick generates clicks on touches that stop scrolling
// - pull-to-refresh should animate smoothly
// - we want to hide the navbar when scrolling down but make
//   it easily available (by showing when scrolling up)
// - zynga scroller is nice as it doesn't touch the DOM at all,
//   it just contains the scroll computation logic
//
// Entry point is the 'scroller' directive. You put that directive
// on the content element that is to be scroller. It'll:
// - modify the parent (container) element appropriately and
//   create an angular controller for pull-to-refresh to hook onto.
// - generate clicks on appropriate touchend events
// - highlight elements that have the 'highlight' attribute on touchstart
// - scroll the navbar into and out of view.
// - set a 'scroller' field on the scope that has a scrollTop function
//   that you should use instead of the jQuery scrollTop
//
// Limitations compared to earlier approaches:
// - non-highlighted color is forced to white
// - some hardcoded assumptions (listed under Assumptions in the
//   code below and in lib/scroller_base.js) instead of angular directives
//
// TODO:
// - doesn't handle contenteditable elements
// - use on all views, not just the entrylist
//
// Possible future work:
// - bring other elements into view when scrolling up, not just
//   the nav
// - animate the pull-to-refresh more, like the google+ app does

atemi.angular.module([
], {
    zscroller: 'lib/atemi/zynga-scroller.js',
    jQuery : 'lib/atemi/jquery.js',
    _ : 'lib/atemi/underscore.js',
    scroller_base : 'lib/scroller_base.js',
}, function(imp, module) {
    var $ = imp.jQuery;
    var Scroller = imp.zscroller.Scroller;
    var _ = imp._;
    var scroller_base = imp.scroller_base;
    var USE_SCROLLER = 'ontouchstart' in window;

    // Assumptions that maybe should be parametrized
    var FIND_NAV = function(content) {
        return content.parent().parent().find("nav");
    };
    var FIND_REFRESHER = function(content) {
        return content.parent().find(".refresher");
    };
    var NAV_SIZE = 44;

    // The directive
    module.directive('scroller', ['$timeout', function($timeout) {
        return {
            restrict: 'A',
            controller: function(/*$scope, $element, $attrs, $transclude, otherInjectables*/) {
                if (USE_SCROLLER) { return {}; }
                else              { return undefined; }
            },
            link: function(scope, element, attrs, scrollerController) {
                var container = element[0].parentNode;
                if (!USE_SCROLLER) {
                    container.style['overflow-y'] = 'scroll';
                    return;
                }
                // Remove default scrolling behaviour until the scroller
                // has been instantiated.
                var prevent = function(ev) {
                    ev.preventDefault();
                };
                document.addEventListener("ontouchstart", prevent, false);
                $(container).scrollTop(1);
                container.style['-webkit-overflow-scrolling'] = 'none';
                container.style['overflow-y'] = 'hidden';
                // Set content up for moving about.
                var content = element[0];
                content.style['-webkit-transform-origin'] = "left top";
                content.style.position = "relative";
                $timeout(function() {
                    // Only instantiate the scroller later, because not
                    // all of the DOM is there yet before.
                    scope.scroller = createScroller(scope, element, scrollerController);
                    document.removeEventListener("ontouchstart", prevent);
                });
            },
        };
    }]);

    var DEBUG = function() {
        // console.log.apply(console, arguments);
    };

    // The zynga scroller:
    // - doesn't have a destroy method
    // - is somewhat expensive to create
    // - is fully headless - not connected to the DOM
    // hence we create one and pass callbacks to the current delegate.
    //
    // There is supposed to only be one scroller and one delegate
    // active at a time. However, new views are created before old
    // ones are destroyed, so we check that whether we still are the
    // current delegate in a couple of places.
    //
    // Note that we use the default options so the scroller itself is
    // set up to do horizontal scroll too - we just don't render that.
    var getZScroller;
    var the_delegate;
    (function() {
        var the_scroller;
        getZScroller = function(delegate, scope) {
            the_delegate = delegate;
            if (scope) {
                scope.$on('$destroy', function() {
                    if (the_delegate === delegate) {
                        the_delegate = null;
                    }
                });
            }
            if (!the_scroller) {
                the_scroller = new Scroller(function() {
                    if (the_delegate) {
                        the_delegate.render.apply(the_delegate, arguments);
                    }
                });
                /* The pull to refresh is buggy, couldn't figure out how
                 * to fix it so do our own
                var callIf = function(name, fallback) {
                    name = "refresh_" + name;
                    return function() {
                        if (the_delegate && the_delegate[name]) {
                            return the_delegate[name].apply(the_delegate, arguments);
                        }
                        if (fallback) {
                            return fallback();
                        }
                        DEBUG(name);
                    };
                };
                var deactivate = function() {
                    window.setTimeout(function() {
                        the_scroller.finishPullToRefresh();
                    }, 5000);
                };
                the_scroller.activatePullToRefresh(70,
                    callIf("activateCallback"),
                    callIf("deactivateCallback"),
                    callIf("startCallback", deactivate)
                );
                */
            }
            return the_scroller;
        };
    })();
    getZScroller(null, null);

    function createScroller(scope, content0, scrollerController) {
        var content = $(content0);
        var nav = FIND_NAV(content);
        if (nav) nav = nav[0];
        var refresher = FIND_REFRESHER(content)[0];
        content = content[0];
        var container = content.parentNode;

        // Last content dimensions we gave to the scroller so we can skip
        // calling it if the size didn't change.
        var last_content_dimensions = [0, 0, 0, 0];
        // State for element scroll calculations
        // Previous scroll position
        var prev = 0;
        // Current top of navbar
        var navtop = 0;

        var render = function(left, top /*, zoom */) {
            // Calculate content and refresher position
            var content_top = -1 * top;
            if (content_top < 0) {
                content_top += scroller.refresher_height;
            } else {
                content_top = Math.max(content_top, scroller.refresher_height);
            }
            refresher.style['-webkit-transform'] = 'translate3d(0, ' + content_top + 'px, 0)';
            content.style['-webkit-transform'] = 'translate3d(0, ' + content_top + 'px, 0)';
            if (nav) {
                var prev_navtop = navtop;
                // Calculate navbar position - bring it into view when scrolling up and
                // hide when scrolling down.
                if (prev < top) {
                    navtop += (top - prev);
                    prev = top;
                } else {
                    if (navtop > NAV_SIZE) navtop = NAV_SIZE;
                    navtop -= (prev-top);
                    if (navtop < 0) navtop = 0;
                    prev = top;
                }
                if (top >= 0 && top <= NAV_SIZE) {
                    if (top < navtop) navtop = top;
                }
                if (top < 0) {
                    navtop = 0;
                }
                if (prev_navtop !== navtop) {
                    nav.style['-webkit-transform'] = 'translate3d(0, -' + navtop + 'px, 0)';
                }
            }
            prev = top;
        };

        var scroller = scroller_base.hook_scroller(
            scope, container, scrollerController, getZScroller(null, scope), render);
        the_delegate = scroller;
        var reflow = function() {
            if (the_delegate !== scroller) return;
            DEBUG("reflow");
            // set the right scroller dimensions
            var dims = [
                container.clientWidth,
                container.clientHeight,
                content.offsetWidth,
                content.offsetHeight + NAV_SIZE
            ];
            if (_.isEqual(dims, last_content_dimensions)) { return; }
            last_content_dimensions = dims;

            scroller.setDimensions.apply(scroller, dims);
            var rect = container.getBoundingClientRect();
            scroller.setPosition(rect.left + container.clientLeft,
                                 rect.top + container.clientTop);
        };
        var triggerReflow = _.debounce(reflow, 50);
        scope.$watch(function() {
            triggerReflow();
        });
        reflow();
        return scroller;
    }

});
