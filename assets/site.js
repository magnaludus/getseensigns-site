// Quote form: posts to data-endpoint (Formspree/Web3Forms) when set, otherwise opens a pre-filled email to sales@.
(function(){
  var y=document.getElementById('yr'); if(y) y.textContent=new Date().getFullYear();
  var f=document.getElementById('quote-form'); if(!f) return;
  // ?product=Name preselects the product (links from the product pages)
  try{var want=new URLSearchParams(location.search).get('product');if(want){var sel=f.elements.product;for(var i=0;i<sel.options.length;i++){if(sel.options[i].text===want){sel.selectedIndex=i;break;}}}}catch(_){}
  var status=f.querySelector('.form-status');
  var labels={name:'Name',email:'Email',product:'Product',quantity:'Quantity',size:'Size',needed_by:'Needed by',details:'Details'};
  function say(msg,err){status.textContent=msg;status.className='form-status'+(err?' err':'');}
  f.addEventListener('submit',function(e){
    e.preventDefault();
    var bad=null;
    ['name','email','product'].forEach(function(n){var el=f.elements[n];var ok=el.value.trim()&&(n!=='email'||/.+@.+\..+/.test(el.value));el.setAttribute('aria-invalid',ok?'false':'true');if(!ok&&!bad)bad=el;});
    if(bad){say('Please fill in your name, a valid email, and the product.',true);bad.focus();return;}
    if(f.elements._gotcha.value) return;
    var data=new FormData(f); data.delete('_gotcha');
    var ep=f.dataset.endpoint;
    if(ep){
      // TODO(form backend): Web3Forms also needs a hidden input name="access_key". Formspree needs nothing extra.
      say('Sending…');
      fetch(ep,{method:'POST',body:data,headers:{Accept:'application/json'}}).then(function(r){
        if(!r.ok) throw 0; f.reset(); say('Thanks! We got your request and will reply within 1 business day. Reply to our email with any logo or photo files.');
      }).catch(function(){say('Something went wrong. Please email sales@getseensignsco.com directly.',true);});
      return;
    }
    var body=Object.keys(labels).map(function(k){return labels[k]+': '+(data.get(k)||'-');}).join('\n')+'\n\n(Attach your logo or photos to this email if you have them.)';
    var subj='Quote request: '+data.get('product')+' ('+data.get('name')+')';
    window.location.href='mailto:'+f.dataset.mailto+'?subject='+encodeURIComponent(subj)+'&body='+encodeURIComponent(body);
    say('Your email app should open with everything filled in. Just hit send. Nothing opened? Email sales@getseensignsco.com.');
  });
})();

// Mobile chat control. Direct text, WhatsApp and phone links. Hidden on the designer
// and whenever it would sit on a quote, order or proof button. No analytics.
(function(){
  var root=document.getElementById('reach');
  if(!root) return;
  var path=location.pathname;
  if(path==='/design' || path.indexOf('/design/')===0){ root.remove(); return; }
  var ticking=false;
  function zone(){
    var vv=window.visualViewport;
    var h=vv?vv.height:window.innerHeight;
    var w=vv?vv.width:window.innerWidth;
    var top=vv?vv.offsetTop:0;
    var left=vv?vv.offsetLeft:0;
    return {left:left+w-168, right:left+w-4, top:top+h-96, bottom:top+h-4};
  }
  function overlaps(a,b){ return a.left<b.right && a.right>b.left && a.top<b.bottom && a.bottom>b.top; }
  function check(){
    ticking=false;
    var show=window.matchMedia('(max-width: 760px) and (min-height: 481px)').matches;
    if(!show){ root.classList.remove('is-clear'); root.removeAttribute('inert'); return; }
    var box=zone();
    var nodes=document.querySelectorAll('.cta-row .btn, .quote-form .btn, .buy, .dz-cta, .card-cta');
    var cover=false;
    for(var i=0;i<nodes.length;i++){
      var r=nodes[i].getBoundingClientRect();
      if(r.width<1 || r.height<1) continue;
      if(overlaps(r, box)){ cover=true; break; }
    }
    root.classList.toggle('is-clear', cover);
    if(cover){ root.open=false; root.setAttribute('inert',''); }
    else root.removeAttribute('inert');
  }
  function schedule(){ if(!ticking){ ticking=true; requestAnimationFrame(check); } }
  window.addEventListener('scroll', schedule, {passive:true});
  window.addEventListener('resize', schedule);
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize', schedule);
    window.visualViewport.addEventListener('scroll', schedule);
  }
  document.addEventListener('keydown', function(e){
    if(e.key==='Escape' && root.open){
      root.open=false;
      var sum=root.querySelector('summary');
      if(sum) sum.focus();
    }
  });
  check();
})();
