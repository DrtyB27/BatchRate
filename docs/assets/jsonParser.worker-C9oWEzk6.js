(function(){"use strict";self.onmessage=function(e){try{const s=JSON.parse(e.data);self.postMessage({ok:!0,data:s})}catch(s){self.postMessage({ok:!1,error:s.message||"Invalid JSON"})}}})();
