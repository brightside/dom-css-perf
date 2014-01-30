define(function() {
//============================================================================
//  Endoding bytestrings in hex
//============================================================================
var hexdigits = "0123456789abcdef";

return function(x) {
    if (typeof x == 'string') {
        var h = "";
        for (var i = 0; i < x.length; ++i) {
            var c = x.charCodeAt(i);
            h += hexdigits[c >>> 4];
            h += hexdigits[c & 0xf];
        }
        return h;
    }
    if (typeof x == 'number') {
        var sign = "";
        if (x < 0) { x = -x; sign = '-'; }
        var s = '00000000' + x.toString(16);
        return sign + s.substring(s.length - 8);
    }
};

});
