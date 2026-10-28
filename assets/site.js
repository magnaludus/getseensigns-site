// Quote form: posts to data-endpoint (/api/quote-request). It never opens the visitor's email app.
// If sending fails (server error, 503, network) the typed answers stay in the form and in localStorage, the page
// retries by itself (3 tries, with a pause between), and then says plainly how to try again or call or text.
// One random "attempt" id goes with every try of the same answers, so a retry cannot save or email it twice.
(function(){
  var y=document.getElementById('yr'); if(y) y.textContent=new Date().getFullYear();
  var f=document.getElementById('quote-form'); if(!f) return;
  var status=f.querySelector('.form-status');
  var btn=f.querySelector('button[type="submit"]');
  var btnHtml=btn?btn.innerHTML:'';
  var PHONE='(334) 232-9003', TEL='tel:+13342329003', SMS='sms:+13342329003?body=Hi%2C%20I%20have%20a%20question%20about%20a%20sign';
  var KEY='gss-quote-draft', KEEP_MS=7*24*3600*1000, PAUSES=[1500,4000], TIMEOUT_MS=20000;
  var FIELDS=['name','email','product','quantity','size','needed_by','details'];
  var started=Date.now();
  var names={name:'your name',email:'a valid email',product:'the product',quantity:'a whole-number quantity',needed_by:'a valid date'};
  var busy=false, attempt='', failed=false, timer=0;

  function store(fn){try{return fn(window.localStorage);}catch(_){return null;}}
  function readDraft(){
    var raw=store(function(ls){return ls.getItem(KEY);}); if(!raw) return null;
    try{var d=JSON.parse(raw); if(d&&d.v&&Date.now()-d.t<KEEP_MS) return d.v;}catch(_){}
    store(function(ls){ls.removeItem(KEY);}); return null;
  }
  function saveDraft(){
    var v={},any=false;
    FIELDS.forEach(function(n){var el=f.elements[n]; if(el&&el.value){v[n]=el.value; if(n!=='product') any=true;}});
    store(function(ls){if(any) ls.setItem(KEY,JSON.stringify({t:Date.now(),v:v})); else ls.removeItem(KEY);});
  }
  function clearDraft(){store(function(ls){ls.removeItem(KEY);});}

  // ?product=Name preselects the product (links from the product pages)
  var want=null;
  try{want=new URLSearchParams(location.search).get('product');}catch(_){}
  var draft=readDraft(), restored=false;
  if(draft){FIELDS.forEach(function(n){var el=f.elements[n]; if(el&&draft[n]&&!el.value){el.value=draft[n]; restored=true;}});}
  if(want){var sel=f.elements.product;for(var i=0;i<sel.options.length;i++){if(sel.options[i].text===want){sel.selectedIndex=i;break;}}}

  function el(tag,text,attrs){var n=document.createElement(tag); if(text) n.textContent=text; for(var k in (attrs||{})) n.setAttribute(k,attrs[k]); return n;}
  function say(msg,err,help){
    status.textContent=msg; status.className='form-status'+(err?' err':'');
    if(help){
      status.appendChild(document.createTextNode(' Call '));
      status.appendChild(el('a',PHONE,{href:TEL}));
      status.appendChild(document.createTextNode(' or '));
      status.appendChild(el('a','text us',{href:SMS}));
      status.appendChild(document.createTextNode(' and we will take it from there.'));
    }
  }
  function setBusy(on,label){
    busy=on; if(!btn) return; btn.disabled=on;
    if(on) btn.textContent=label||'Sending…'; else btn.innerHTML=failed?'Try again <span aria-hidden="true">→</span>':btnHtml;
  }
  function newId(){
    var a=new Uint8Array(12);
    try{window.crypto.getRandomValues(a);}catch(_){for(var i=0;i<a.length;i++) a[i]=Math.floor(Math.random()*256);}
    return Array.prototype.map.call(a,function(b){return ('0'+b.toString(16)).slice(-2);}).join('');
  }
  function onEdit(){
    attempt=''; clearTimeout(timer); timer=setTimeout(saveDraft,400);
  }
  f.addEventListener('input',onEdit); f.addEventListener('change',onEdit);
  if(restored&&!want){say('Welcome back. We kept what you typed.',false);}

  // One try. Resolves {status, body}; status 0 means the network failed or timed out.
  function send(post){
    var ctl=window.AbortController?new AbortController():null;
    var t=ctl?setTimeout(function(){ctl.abort();},TIMEOUT_MS):0;
    return fetch(f.dataset.endpoint,{method:'POST',body:post,headers:{Accept:'application/json'},signal:ctl?ctl.signal:undefined}).then(function(r){
      return r.json().catch(function(){return {};}).then(function(j){clearTimeout(t);return {status:r.status,body:j};});
    },function(){clearTimeout(t);return {status:0,body:{}};});
  }
  function worthRetrying(res){
    if(res.status===0||res.status===408||res.status>=500&&res.status!==503) return true;
    return res.status===503&&res.body&&res.body.enabled!==false;
  }
  function run(post,n){
    return send(post).then(function(res){
      if(res.status===200&&res.body&&res.body.ok) return res;
      if(n<PAUSES.length&&worthRetrying(res)){
        say('Hang on, still trying… ('+(n+2)+' of '+(PAUSES.length+1)+')',false);
        return new Promise(function(done){setTimeout(done,PAUSES[n]);}).then(function(){return run(post,n+1);});
      }
      return res;
    });
  }

  f.addEventListener('submit',function(e){
    e.preventDefault();
    if(busy) return;
    var bad=null;
    ['name','email','product'].forEach(function(n){var el=f.elements[n];var ok=el.value.trim()&&(n!=='email'||/.+@.+\..+/.test(el.value));el.setAttribute('aria-invalid',ok?'false':'true');if(!ok&&!bad)bad=el;});
    if(bad){say('Please fill in your name, a valid email, and the product.',true);bad.focus();return;}
    if(f.elements._gotcha.value) return;
    saveDraft();
    if(!attempt) attempt=newId();
    var post=new FormData(f); post.append('elapsedMs',String(Date.now()-started)); post.append('attempt',attempt);
    setBusy(true); say('Sending…',false);
    run(post,0).then(function(res){
      var j=res.body||{};
      if(res.status===200&&j.ok){
        failed=false; setBusy(false); attempt='';
        f.reset(); clearDraft(); started=Date.now();
        if(j.emailed) say('Thanks! We got your request (reference '+j.ref+') and will reply within 1 business day.'+(j.confirmed?' We emailed you a confirmation. ':' ')+'Reply to our email with any logo or photo files.',false);
        else say('Thanks! Your request is saved (reference '+j.ref+'). Our email hiccuped, so if you have not heard from us in 1 business day, call or text '+PHONE+' and give us that reference.',false);
        return;
      }
      if(res.status===400){
        failed=false; setBusy(false);
        var list=(j.fields||[]).map(function(n){return names[n];}).filter(Boolean);
        var first=(j.fields||[])[0]; if(first&&f.elements[first]) {f.elements[first].setAttribute('aria-invalid','true');f.elements[first].focus();}
        say(list.length?'Please check '+list.join(', ')+'.':'Please check the form and try again.',true);
        return;
      }
      failed=false; setBusy(false);
      if(res.status===429){say('You have sent a few requests already. Please try again later.',true,true);return;}
      failed=true; setBusy(false);
      if(res.status===503&&j.enabled===false) say('Online requests are paused right now. What you typed is still here.',true,true);
      else say('That did not go through, and we are sorry. What you typed is still here. Tap Try again.',true,true);
    });
  });
})();

// Mobile message button: text, WhatsApp, or a phone call. Plain links only.
// Hidden on /design/ (the designer has its own bottom bar) and whenever it would cover a CTA.
(function(){
  var root=document.getElementById('chat-fab');
  if(!root) return;
  var path=location.pathname;
  if(path==='/design'||path.indexOf('/design/')===0||document.querySelector('.designer')){root.remove();return;}
  var btn=root.querySelector('.chat-fab-btn');
  var panel=document.getElementById('chat-fab-panel');
  if(!btn||!panel) return;
  function setOpen(open){
    panel.hidden=!open;
    btn.setAttribute('aria-expanded',open?'true':'false');
    if(open){var first=panel.querySelector('a');if(first) first.focus();}
  }
  function away(on){
    root.classList.toggle('chat-fab-away',on);
    btn.tabIndex=on?-1:0;
    if(on){root.setAttribute('aria-hidden','true');if(!panel.hidden) setOpen(false);}
    else root.removeAttribute('aria-hidden');
  }
  function fieldFocused(){
    var t=document.activeElement;
    return !!(t&&t.matches&&t.matches('input,textarea,select')&&!root.contains(t));
  }
  btn.addEventListener('click',function(){setOpen(panel.hidden);});
  document.addEventListener('click',function(e){if(!panel.hidden&&!root.contains(e.target)) setOpen(false);});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!panel.hidden){setOpen(false);btn.focus();}});
  document.addEventListener('focusin',schedule);
  document.addEventListener('focusout',function(){setTimeout(schedule,80);});
  var targets=document.querySelectorAll('.cta-row, .reach, .quote-form, .card-cta, a.buy, .dz-cta, .final, .nav .btn');
  function hits(){
    var box=btn.getBoundingClientRect();
    if(box.width<1||box.height<1) return false;
    var pad=8,L=box.left-pad,R=box.right+pad,T=box.top-pad,B=box.bottom+pad;
    for(var i=0;i<targets.length;i++){
      var r=targets[i].getBoundingClientRect();
      if(r.width<1||r.height<1) continue;
      if(!(r.right<L||r.left>R||r.bottom<T||r.top>B)) return true;
    }
    return false;
  }
  var raf=0;
  function place(){
    raf=0;
    if(window.matchMedia('(min-width:761px)').matches){away(false);return;}
    away(fieldFocused()||hits());
  }
  function schedule(){if(!raf) raf=requestAnimationFrame(place);}
  window.addEventListener('scroll',schedule,{passive:true});
  window.addEventListener('resize',schedule);
  place();
})();
