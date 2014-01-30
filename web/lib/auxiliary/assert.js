define(function() {
    return function() {
        /* global console */
        console.assert.apply(console, arguments);
        if (! arguments[0]) {
            /* jshint debug: true */
            debugger;
            var msg = "assertion failed:";
            for (var i = 0; i < arguments.length; i++) {
                msg = msg + " " + arguments[i];
            }
            throw new Error(msg);
        }
    };
});
