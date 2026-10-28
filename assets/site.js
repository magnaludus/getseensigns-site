// Quote form: posts to data-endpoint (/api/quote-request). The pre-filled email to sales@ is only the fallback
// for a server error, a 503 (online requests switched off) or a network failure. A success or a validation
// message never opens the email app.
(function(){
  var y=document.getElementById('yr'); if(y) y.textContent=new Date().getFullYear();
  var f=document.getElementById('quote-form'); if(!f) return;
  // ?product=Name preselects the product (links from the product pages)
  try{var want=new URLSearchParams(location.search).get('product');if(want){var sel=f.elements.product;for(var i=0;i<sel.options.length;i++){if(sel.options[i].text===want){sel.selectedIndex=i;break;}}}}catch(_){}
  var status=f.querySelector('.form-status');
  var started=Date.now();
  var labels={name:'Name',email:'Email',product:'Product',quantity:'Quantity',size:'Size',needed_by:'Needed by',details:'Details'};
  var names={name:'your name',email:'a valid email',product:'the product',quantity:'a whole-number quantity',needed_by:'a valid date'};
  var busy=false;
  function say(msg,err){status.textContent=msg;status.className='form-status'+(err?' err':'');}
  function fallback(data,ref,why){
    var body=Object.keys(labels).map(function(k){return labels[k]+': '+(data.get(k)||'-');}).join('\n')+(ref?'\nReference: '+ref:'')+'\n\n(Attach your logo or photos to this email if you have them.)';
    var subj='Quote request: '+data.get('product')+' ('+data.get('name')+')'+(ref?' '+ref:'');
    f.dataset.fallback=String((+f.dataset.fallback||0)+1);
    window.location.href='mailto:'+f.dataset.mailto+'?subject='+encodeURIComponent(subj)+'&body='+encodeURIComponent(body);
    say((why?why+' ':'')+'Your email app should open with everything filled in. Just hit send. Nothing opened? Email sales@getseensignsco.com.',true);
  }
  f.addEventListener('submit',function(e){
    e.preventDefault();
    if(busy) return;
    var bad=null;
    ['name','email','product'].forEach(function(n){var el=f.elements[n];var ok=el.value.trim()&&(n!=='email'||/.+@.+\..+/.test(el.value));el.setAttribute('aria-invalid',ok?'false':'true');if(!ok&&!bad)bad=el;});
    if(bad){say('Please fill in your name, a valid email, and the product.',true);bad.focus();return;}
    if(f.elements._gotcha.value) return;
    var data=new FormData(f); data.delete('_gotcha');
    var ep=f.dataset.endpoint;
    if(!ep){fallback(data,'','');return;}
    var post=new FormData(f); post.append('elapsedMs',String(Date.now()-started));
    busy=true; say('Sending…');
    fetch(ep,{method:'POST',body:post,headers:{Accept:'application/json'}}).then(function(r){
      return r.json().catch(function(){return {};}).then(function(j){return {status:r.status,body:j};});
    }).then(function(res){
      busy=false;
      var j=res.body||{};
      if(res.status===200&&j.ok&&j.emailed){
        f.reset(); started=Date.now();
        say('Thanks! We got your request (reference '+j.ref+') and will reply within 1 business day.'+(j.confirmed?' We emailed you a confirmation. ':' ')+'Reply to our email with any logo or photo files.');
        return;
      }
      if(res.status===200&&j.ok){fallback(data,j.ref,'We saved your request (reference '+j.ref+') but could not send it to our inbox.');return;}
      if(res.status===400){
        var list=(j.fields||[]).map(function(n){return names[n];}).filter(Boolean);
        var first=(j.fields||[])[0]; if(first&&f.elements[first]) {f.elements[first].setAttribute('aria-invalid','true');f.elements[first].focus();}
        say(list.length?'Please check '+list.join(', ')+'.':'Please check the form and try again.',true);
        return;
      }
      if(res.status===429){say('You have sent a few requests already. Please try again later, or text or call (334) 232-9003.',true);return;}
      fallback(data,'','Online requests are not available right now.');
    }).catch(function(){busy=false;fallback(data,'','We could not reach our server.');});
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
