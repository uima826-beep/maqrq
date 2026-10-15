(function(){
  var SECRET = "mQ9xR4kL7pW2vN8j";

  function xorEncrypt(text) {
    var encoder = new TextEncoder();
    var bytes = encoder.encode(text);
    var result = new Uint8Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) {
      result[i] = bytes[i] ^ SECRET.charCodeAt(i % SECRET.length);
    }
    var binary = '';
    for (var i = 0; i < result.length; i++) {
      binary += String.fromCharCode(result[i]);
    }
    return btoa(binary);
  }

  window.encryptPayload = function(obj) {
    var json = JSON.stringify(obj);
    var ts = Date.now().toString(36);
    var payload = ts + "." + json;
    return xorEncrypt(payload);
  };
})();
