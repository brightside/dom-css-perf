define(function() {
    return function() {
        return navigator.userAgent.match(
            /(iPad)|(iPhone)|(iPod)|(android)|(webOS)|(Windows Phone)/i);
    };
});
