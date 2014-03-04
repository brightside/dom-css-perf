define([
    'lib/auxiliary/assert',
    'lib/lazy_scroll',
    'jquery',
    'lib/auxiliary/is_mobile',
], function(assert, lazy_scroll_mod, $, is_mobile) { "use strict";

var module = angular.module('lib/angular_lazy_scroll', [], function() {});

module.directive('lazyScroller', function() {
    return {
        restrict: 'A',
        controller: function(/*$scope, $element, $attrs, $transclude, otherInjectables*/) {
            if (is_mobile()) {
                return {};
            } else {
                return;
            }
        },
    };
});

module.directive('lazyRepeat', function() {
    return {
        restrict: 'A',
        transclude: 'element',
        require: '?^lazyScroller',
        priority: 1000,
        terminal: true,
        compile: function(elem, attr, linker) {
            var container = $(elem[0].parentNode);
            assert(container[0]);
            return function($scope, $element, $attr, scrollerController) {
                var expression = $attr.lazyRepeat;
                var match = expression.match(/^\s*(.+)\s+as\s+(.*?)\s*$/);
                if (!match) {
                    throw new Error("Expected lazyRepeat in form of '_items as _name' but got '" +
                                    expression + "'.");
                }
                var items_name = match[1];
                var items = $scope[items_name];
                var as = match[2];
                var lister = {
                    count: function() { return items.count(); },
                    item: function(i) {
                        var scope = $scope.$new();
                        scope[as] = items.data(i);
                        var elem;
                        linker(scope, function(cloned) { elem = cloned; });
                        try {
                            scope.$digest();
                        } catch(e) {
                            logger.error("DIGEST E", e);
                        }
                        return elem[0];
                    },
                    destroy: function(node /* , i */) {
                        var scope = angular.element(node).scope();
                        node.parentNode.removeChild(node);
                        if (scope) {
                            // there might not be any scope if the scope has already
                            // been destroyed (navigated away from the view)
                            scope.$destroy();
                        }
                    },
                };
                if (items.height) {
                    lister.height = function(i) { return items.height(i); };
                }

                var lazy_scroll;
                var options = { };

                var resized = function() {};
                var create = function() {
                    if (lazy_scroll) {
                        lazy_scroll.recreate();
                    } else {
                        var margin;
                        if (is_mobile()) {
                            if (document.body.style.height) {
                                margin = parseInt(document.body.style.height, 10) - parseInt(container[0].style.height, 10);
                            } else {
                                margin = window.innerHeight - parseInt(container[0].style.height, 10);
                            }
                            lazy_scroll = lazy_scroll_mod.create_with_scroller($scope, lister, container, options, scrollerController);
                            resized = function() {
                                if (document.body.style.height) {
                                    container[0].style.height = "" + (parseInt(document.body.style.height, 10) - margin) + "px";
                                } else {
                                    container[0].style.height = "" + (window.innerHeight - margin) + "px";
                                }
                                lazy_scroll.recreate();
                            };
                        } else {
                            lazy_scroll = lazy_scroll_mod.create_with_div($scope, lister, container, options);
                            margin = window.innerHeight - parseInt(container[0].style.height, 10);
                            resized = function() {
                                container[0].style.height = "" + (window.innerHeight - margin) + "px";
                                lazy_scroll.recreate();
                            };
                        }
                        window.addEventListener("resize", resized);
                        window.addEventListener("orientationchange", resized);
                    }
                };
                var creating;
                $scope.$watch(items_name + ".count()", function() {
                    if (creating) return;
                    creating = window.setTimeout(function() {
                        creating = null;
                        create();
                    }, 1);
                });
                $scope.$on('$destroy', function() {
                    if (creating) {
                        window.clearTimeout(creating);
                    } else {
                        window.removeEventListener("resize", resized);
                        window.removeEventListener("orientationchange", resized);
                        lazy_scroll.release();
                    }
                });
            };

        },
    };
});

});
