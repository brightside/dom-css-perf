// Lazily rendered ('infinite' - not quite, but supports at least
// 1M items) list.
//
// Some design notes:
// - the estimated height of any item should at each step get closer
//   to the real height, otherwise the rendering will not stabilize -
//   that's why cache the leaf heights and pass heights around on
//   create and release (this would happen for example if the height
//   of a node is always estimated larger that what it ends up being
//   rendered to, so that it would first be wanted to appear, then
//   removed again, lazy_scrollly)
//
// - nodes are recycled to reduce GC
//
// - to show really large lists it's important to only keep the minimal
//   amount of nodes in memory (the visible ones + a bit of buffer +
//   the path from those to the root), so nodes are pruned immediately
//
// - the closer the estimated height of the rows is to the true one, 
//   the quicker the rendering stabilizes; if the rows are all the same,
//   known height, the position will be correct at once
//
// - we evaluate the height of the newly created DOM nodes asynchronously
//   so that we consolidate the style recalculation and layout
//
// - it's good if the guessed height is enough to show the part of the
//   item that the user is looking for
//
// Stabilization has been tested with incremental and random scrolling,
// otherwise tested manually.
//

define([
    'lib/scroller_base',
    'lib/atemi/zynga-scroller',
], function(scroller_base, Scroller_mod) {

var module = {};

var Scroller = Scroller_mod.Scroller;

var treecache = [];
var leafcache = [];

var check = function(val) {
    if (!val) {
        throw new Error("assert failed");
    }
};

var NODESIZE = 3;

var TreeNode = function(parent, first_i, last_i, parent_i, h, lister, height_cache, height_queue) {
    var that = this;
    if (! (that instanceof TreeNode)) {
        that = treecache.pop();
        if (! that) {
            that = Object.create(TreeNode.prototype);
        }
    }
    that._released = false;
    that._parent = parent;
    that._first_i = first_i;
    that._last_i = last_i;
    that._parent_i = parent_i;
    that._h = h;
    that._step = Math.ceil((last_i - first_i) / NODESIZE);
    that._childCount = Math.ceil((last_i - first_i) / that._step);
    that._lister = lister;
    that._height_cache = height_cache;
    that._height_queue = height_queue;
    if (!that._children) {
        that._children = [];
        that._children.length = NODESIZE;
    }
    if (!that._heights) {
        that._heights = [];
        that._heights.length = NODESIZE;
    }
    return that;
};
TreeNode.prototype = {};
TreeNode.prototype.getHeight = function() {
    // 0 height is used to indicate 'not yet calculated', the height
    // arrays may also contain undefined if the child doesn't exist
    check(! this._released);
    if (this._h) return this._h;
    var found_sum_h = 0, found_n_h = 0, child_h;
    for (var i = 0; i < this._childCount; i++) {
        if (this._children[i]) {
            child_h = this._children[i].getHeight();
            found_sum_h += child_h;
            this._heights[i] = child_h;
            found_n_h++;
        } else if (this._heights[i]) {
            found_sum_h += this._heights[i];
            found_n_h++;
        } else if (this._step === 1 && this._height_cache[this._first_i + i]) {
            child_h = this._height_cache[this._first_i + i];
            found_sum_h += child_h;
            this._heights[i] = child_h;
            found_n_h++;
        }
    }
    if (found_n_h === 0) {
        this._h = this._lister.height(this._first_i) * (this._last_i - this._first_i);
    } else {
        this._h = found_sum_h * this._childCount / found_n_h;
    }
    return this._h;
};
TreeNode.prototype.getChildHeight = function(i) {
    check(! this._released);
    if (this._heights[i]) {
        return this._heights[i];
    } else if (this._step === 1 && this._height_cache[this._first_i + i]) {
        return this._height_cache[this._first_i + i];
    } else {
        return this.child(i).getHeight();
    }
};
TreeNode.prototype.invalidateHeight = function(i, h) {
    check(! this._released);
    if (h && this._heights[i] === h) return;
    this._heights[i] = h;
    if (!this._h) {
        // already invalidated, don't propagate up - this is a significant
        // optimization with low NODESIZE / high tree depth
        return;
    }
    this._h = 0;
    if (this._parent) {
        this._parent.invalidateHeight(this.parent_i, 0);
    }
};

TreeNode.prototype.child = function(i, only_if_exists) {
    check(! this._released);
    var child = this._children[i];
    if (!child && !only_if_exists) {
        var h = 0;
        if (this._step === 1) {
            child = LeafNode(this, this._first_i + i, i, this._heights[i], this._lister,
                             this._height_cache, this._height_queue);
        } else {
            var first_i = this._first_i + i * this._step;
            var last_i = first_i + this._step;
            child = TreeNode(this, first_i, last_i <= this._last_i ? last_i : this._last_i, i, this._heights[i],
                             this._lister, this._height_cache, this._height_queue);
        }
        h = this._heights[i] || child.getHeight();
        this._children[i] = child;
        this.invalidateHeight(i, h);
    }
    return child;
};
TreeNode.prototype.node_by_lister_i = function(i)  {
    var relative = i - this._first_i;
    if (this._step === 1) {
        return this._children[relative];
    } else {
        var node = this._children[Math.floor(relative / this._step)];
        return node && node.node_by_lister_i(i);
    }
};

TreeNode.prototype.childCount = function() {
    check(! this._released);
    return this._childCount;
};
TreeNode.prototype.isLeaf = function() { return false; };
TreeNode.prototype.release = function(budget) {
    check(! this._released);
    var i, n;
    for (i = 0; i < this._childCount; i++) {
        if (this._children[i]) {
            budget = this._children[i].release(budget);
        }
    }
    if (this._parent) {
        this._parent.invalidateHeight(this._parent_i, this.getHeight());
        delete this._parent._children[this._parent_i];
    }
    for (i = 0, n = this._childCount; i < n; i++) {
        delete this._children[i];
        delete this._heights[i];
    }
    this._released = true;
    treecache.push(this);
    return budget;
};

var to_remove = [];

var LeafNode = function(parent, i, parent_i, h, lister, heights_cache,
                        height_queue) {
    var that = this;
    if (! (that instanceof LeafNode)) {
        that = leafcache.pop();
        if (! that) {
            that = Object.create(LeafNode.prototype);
        }
    }
    that._h = heights_cache[i] || h;
    that._heights_cache = heights_cache;
    that._height_queue = height_queue;
    that._released = false;
    that._pending = false;
    that._parent = parent;
    that._lister = lister;
    that._i = i;
    that._parent_i = parent_i;
    return that;
};

LeafNode.prototype = {};
LeafNode.prototype.getHeight = function() {
    if (! this._h) {
        if (this._elem) {
            this._h = this._elem.offsetHeight;
        } else {
            this._h = this._lister.height(this._i);
        }
    }
    return this._h;
};
LeafNode.prototype.isLeaf = function() { return true; };
LeafNode.prototype.release = function(budget) {
    if (this._elem) {
        if (budget > 0) {
            var node = this._elem;
            var header = this._header;
            if (this._lister.destroy) this._lister.destroy(node, this._i, this._header);
            if (node.parentNode) node.parentNode.removeChild(node);
            if (header && header.parentNode) header.parentNode.removeChild(header);
            this._elem = null;
            this._header = null;
            budget--;
            if (header) budget--;
        } else {
            this._elem.style["-webkit-transform"] = "translate3d(0, -500px, 0)";
            if (this._header) {
                this._header.style["-webkit-transform"] = "translate3d(0, -500px, 0)";
            }
            to_remove.push([this._elem, this._i, this._header]);
        }
    }
    if (this._parent) {
        delete this._parent._children[this._parent_i];
        this._parent.invalidateHeight(this._parent_i, this._h);
        this._parent = null;
    }
    this._elem = null;
    this._released = true;
    if (!this._pending) {
        leafcache.push(this);
    }
    return budget;
};
LeafNode.prototype.create = function(left, pos, budget, container) {
    if (budget > 0 && !this._elem) {
        this._elem = this._lister.item(this._i);
        if (this._lister.header) {
            this._header = this._lister.header(this._i);
        }
        if ((! this._lister.fixedHeight) || (! this._lister.fixedHeight(this._i))) {
            this._pending = true;
            this._height_queue.push(this);
        }
        container.append(this._elem);
        if (this._header) {
            container.append(this._header);
            budget--;
        }
        budget--;
    }
    if (this._elem) {
        this._elem.style["-webkit-transform"] = "translate3d(" + (-1 * left) + "px, " + pos + "px, 0)";
    }
    if (this._header) {
        this._header.style["-webkit-transform"] = "translate3d(0, " + pos + "px, 0)";
    }
    return budget;
};

var BUFFER = 300;

var walk_nodes = function(left, view_top, draw_top, bottom, node, pos, budget, container) {
    if (node.isLeaf()) {
        budget = node.create(left, pos - draw_top, budget, container);
    } else {
        var child;
        for (var i = 0, n = node.childCount(); i < n; i++) {
            var child_h = node.getChildHeight(i);
            var child_bottom = pos + child_h;
            if (child_bottom < (view_top - BUFFER) || pos > (bottom + BUFFER)) {
                pos += child_h;
                child = node.child(i, true);
                if (child) budget = child.release(budget);
            } else {
                child = node.child(i);
                child_h = child.getHeight();
                child_bottom = pos + child_h;
                if (child_bottom < (view_top - BUFFER)) {
                    budget = child.release(budget);
                    pos += child_h;
                } else {
                    budget = walk_nodes(left, view_top, draw_top, bottom, child, pos, budget, container);
                    pos += child.getHeight();
                }
            }
        }
    }
    return budget;
};

// bar, thumb and scroller are optional
module.create = function(lister, container, scroller, options) {
    var instance = {};
    var height_queue = [];
    var height_cache = [];
    options = options || {};
    var bar = options.bar;
    var thumb = options.thumb;

    var a_h = 50;
    if (! lister.height) {
        lister.height = function(i) { return height_cache[i] || a_h; };
    }
    var root = TreeNode(null, 0, lister.count(), 0, 0, lister, height_cache, height_queue);

    instance.root = root;
    instance.height_cache = height_cache;
    instance.height_queue = height_queue;

    instance.release = function() {
        root.release();
        for (var i = 0, n = height_queue.length; i < n; i++) {
            var self = height_queue[i];
            check(self._released);
            leafcache.push(self);
        }
        height_queue.length = 0;
        cancelRender();
    };

    instance.recreate = function() {
        this.release();
        if (! lister.height) {
            lister.height = function(i) { return height_cache[i] || a_h; };
        }
        root = TreeNode(null, 0, lister.count(), 0, 0, lister, height_cache, height_queue);
    };

    var renderId = null;
    var cancelRender = function() {
        if (renderId) {
            window.clearTimeout(renderId);
            renderId = null;
        }
    };

    var last_top = 0;
    var last_left = 0;
    var triggerRender = function(left, orig_top) {
        last_top = orig_top;
        last_left = left;
        if (renderId) return;
        renderId = window.setTimeout(function() {
            renderId = null;
            render(last_left, last_top, 0);
        }, 1);
    };

    var BUDGET = 2;
    var H, scrollerH, containerHeight, barHeight, thumbHeight;

    H = root.getHeight();

    var setThumbHeight = function() {
        var newH = containerHeight / scrollerH * containerHeight;
        if (newH < 40) {
            newH = 40;
        } else if (newH > containerHeight) {
            newH = containerHeight;
        }
        if (newH === thumbHeight) return;
        thumbHeight = newH;
        thumb.height(thumbHeight);
    };
    instance.reflow = function(scrollerH0) {
        containerHeight = container.innerHeight();
        scrollerH = scrollerH0 || H;
        barHeight = bar ? bar.outerHeight() : 0;
        if (thumb) setThumbHeight();
    };
    window.setTimeout(function() {
        instance.reflow();
    }, 1);

    instance.rendering = function() {
        return !!renderId;
    };

    instance.getHeight = function() { return root.getHeight(); };
    var render = function(left, orig_top, zoom, refresher_height) {
        var started = (new Date()).getTime();

        if (! refresher_height) {
            refresher_height = 0;
        }
        var top = H / scrollerH * orig_top;
        if (bar && bar[0] && thumb && thumb[0]) {
            setThumbHeight();
            var thumbTop = Math.max(0, Math.min(orig_top / scrollerH
                * barHeight, barHeight - thumbHeight));
            thumb[0].style["-webkit-transform"] = "translate3d(0, " + thumbTop + "px, 0)";
        }

        cancelRender();
        var i, n;
        var had_height_queue = height_queue.length > 0;
        if (height_queue.length > 0) {
            var requeued = [];
            for (i = 0, n = height_queue.length; i < n; i++) {
                var self = height_queue[i];
                var h = self._elem.offsetHeight;
                if (h === 0) {
                    requeued.push(self);
                    continue;
                }
                a_h = h;
                self._h = h;
                if (self._parent && ! self._parent._released) {
                    self._parent.invalidateHeight(self._parent_i, self._h);
                }
                self._pending = false;
                self._heights_cache[self._i] = self._h;
                if (self._released) {
                    leafcache.push(self);
                }
            }
            height_queue.length = 0;
            for (i = 0, n = requeued.length; i < n; i++) {
                height_queue.push(requeued[i]);
            }
        }

        if (options.headers) {
            for (i = 0; i < options.headers.length; i++) {
                options.headers[i].style["-webkit-transform"] = "translate3d(" + (left * -1) + "px, 0, 0)";
            }
        }
        var bottom = top + containerHeight;
        var draw_top = (options.draw_at_0 ? 0 : orig_top) - refresher_height;
        var budget = walk_nodes(left, top, draw_top, bottom, root, 0, BUDGET, container);
        if (budget > 0) {
            while (to_remove.length > 0 && budget > 0) {
                var item = to_remove.pop();
                var node = item[0];
                var header = item[2];
                i = item[1];
                if (lister.destroy) lister.destroy(node, i, header);
                if (node.parentNode) node.parentNode.removeChild(node);
                if (header && header.parentNode) header.parentNode.removeChild(header);
                budget--;
            }
        }
        if (budget <= 0 || had_height_queue || height_queue.length > 0) {
            triggerRender(left, orig_top);
        }
        H = root.getHeight();

        var elapsed = (new Date()).getTime() - started;
        if (budget <= 0 && elapsed < 10) {
            BUDGET++;
        }
        // console.log("ELAPSED", elapsed);
    };
    instance.render = render;

    function moveThumb(e) {
        var barTop = bar.offset().top;
        var barHeight = bar.height();
        var thumbHeight = thumb.height();
        var pos;
        if (e.touches && e.touches[0]) {
            pos = e.touches[0].pageY - barTop;
        } else if (e.pageY) {
            pos = e.pageY;
        }
        if (pos === undefined) return;
        pos = pos - barTop;
        if (pos > barHeight - thumbHeight) {
            pos = barHeight - thumbHeight;
        }
        var scrollY = pos / (barHeight - thumbHeight) * scrollerH;
        scroller.scrollTo(0, scrollY);
        e.stopPropagation();
        e.preventDefault();
    }
    if (bar && bar[0] && thumb && thumb[0] && scroller) {
        var down = false;
        bar[0].addEventListener("touchstart", function(e) {
            down = true;
            moveThumb(e);
        });
        bar[0].addEventListener("touchcancel", function() { down = false; });
        bar[0].addEventListener("touchend", function() { down = false; });
        bar[0].addEventListener("touchmove", function(e) {
            if (!down) return;
            moveThumb(e);
        });

        // Note that the mouse events are only to support testing on a desktop,
        // we should hook up to normal scrolling on desktop.
        bar[0].addEventListener("mousedown", function(e) {
            down = true;
            moveThumb(e);
        });
        bar[0].addEventListener("mouseup", function(/* e */) { down = false; });
        bar[0].addEventListener("mouseleave", function(/* e */) { down = false; });
        bar[0].addEventListener("mousemove", function(e) {
            if (!down) return;
            moveThumb(e);
        });
    }
    return instance;
};

module.create_with_scroller = function($scope, lister, container, options, scrollerController) {
    var scrollerH;
    var scroller;
    var outer_render = function() { if (scroller) return scroller.render.apply(scroller, arguments); };
    var lazy_scroll;

    var checking = null;
    var last_top = null;

    options = options || {};

    var containerHeight;
    var set_dims = function() {
        var pos = last_top / (scrollerH ? scrollerH : 1);
        scrollerH = lazy_scroll.getHeight();
        if (scrollerH < container.outerHeight()) {
            scrollerH = container.outerHeight();
        }
        lazy_scroll.reflow(scrollerH);
        scroller.setDimensions(window.innerWidth, container.outerHeight(), container.outerWidth(), scrollerH);
        scroller.scrollTo(0, pos * scrollerH);
        containerHeight = container.outerHeight();
    };
    var render = function(left, top, zoom) {
        last_top = top;
        if (!lazy_scroll) return;
        lazy_scroll.render(left, top, zoom, scroller.refresher_height);
        if (lazy_scroll.getHeight() !== scrollerH) {
            if (checking) {
                window.clearTimeout(checking);
                checking = null;
            }
            checking = window.setTimeout(function() {
                checking = null;
                set_dims();
            }, 100);
        }
    };
    scroller = scroller_base.hook_scroller(
        $scope, container[0], scrollerController, new Scroller(outer_render, { scrollingX: options.scrollingX }),
        render);

    lazy_scroll = module.create(lister, container, scroller, options);
    window.setTimeout(function() {
        set_dims();
    }, 1);

    return {
        lazy_scroll: lazy_scroll,
        scroller: scroller,
        recreate: function() {
            if (checking) {
                window.clearTimeout(checking);
                checking = null;
            }
            lazy_scroll.recreate();
            set_dims();
        },
        release: function() {
            if (checking) {
                window.clearTimeout(checking);
                checking = null;
            }
            lazy_scroll.release();
        }
    };
};

module.create_with_div = function($scope, lister, container, options) {
    var scrollerH;
    var lazy_scroll;
    var div = document.createElement("div");
    div.style.width = '1px;';
    container.append(div);
    div = [div];

    var checking = null;
    var last_top = 0;

    options = options || {};
    options.draw_at_0 = true;

    var containerHeight = 0;
    var set_dims = function() {
        var pos = last_top / (scrollerH ? scrollerH : 1);
        scrollerH = lazy_scroll.getHeight();
        if (scrollerH < container.outerHeight()) {
            scrollerH = container.outerHeight();
        }
        lazy_scroll.reflow(scrollerH);
        div[0].style.height = "" + scrollerH + "px";
        container[0].style.overflow = "auto";
        container[0].scrollTop = pos * scrollerH;
        containerHeight = container.outerHeight();
        render(0, pos * scrollerH, 1);
    };
    var render = function(left, top, zoom) {
        last_top = top;
        if (!lazy_scroll) return;
        lazy_scroll.render(left, top, zoom);
        if (lazy_scroll.getHeight() !== scrollerH) {
            if (checking) {
                window.clearTimeout(checking);
                checking = null;
            }
            checking = window.setTimeout(function() {
                checking = null;
                set_dims();
            }, 100);
        }
    };

    var delegate = {};
    var header_left = 0;
    var header_items = {};
    function set_delegate(lister) {
        delegate.item = lister.item;
        delegate.height = lister.height;
        if (lister.header) {
            delegate.header = function(i) {
                var ret = lister.header(i);
                header_items[i] = ret;
                if (header_left !== 0) {
                    ret.style.left = "" + header_left + "px";
                }
                return ret;
            };
        } else {
            delete delegate.header;
        }
        delegate.count = lister.count;
        delegate.fixedHeight = lister.fixedHeight;
        delegate.destroy = function(node, i, header) {
            if (header === header_items[i]) {
                delete header_items[i];
            }
            if (lister.destroy) {
                lister.destroy(node, i, header);
            }
        };
    }
    set_delegate(lister);

    var scrollHandler = function() {
        var scrollLeft = container[0].scrollLeft;
        render(0, container[0].scrollTop, 1);
        if (scrollLeft !== header_left) {
            var i;
            header_left = scrollLeft;
            if (options.headers) {
                for (i = 0; i < options.headers.length; i++) {
                    options.headers[i].style.left = "" + (-1 * header_left) + "px";
                }
            }
            for (i in header_items) {
                header_items[i].style.left = "" + header_left + "px";
            }
        }
    };
    container[0].addEventListener("scroll", scrollHandler);
    lazy_scroll = module.create(delegate, container, null, options);
    set_dims();

    return {
        lazy_scroll: lazy_scroll,
        recreate: function() {
            if (checking) {
                window.clearTimeout(checking);
                checking = null;
            }
            header_left = 0;
            set_delegate(lister);
            lazy_scroll.recreate();
            set_dims();
        },
        release: function() {
            if (checking) {
                window.clearTimeout(checking);
                checking = null;
            }
            container[0].removeEventListener("scroll", scrollHandler);
            lazy_scroll.release();
            div.remove();
        }
    };
};

return module;

});
