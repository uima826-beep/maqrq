(function(){
  var SECRET = "mQ9xR4kL7pW2vN8j";

  function xorEncrypt(text) {
    var result = [];
    for (var i = 0; i < text.length; i++) {
      result.push(text.charCodeAt(i) ^ SECRET.charCodeAt(i % SECRET.length));
    }
    return btoa(String.fromCharCode.apply(null, result));
  }

  window.encryptPayload = function(obj) {
    var json = JSON.stringify(obj);
    var ts = Date.now().toString(36);
    var payload = ts + "." + json;
    return xorEncrypt(payload);
  };
})();
