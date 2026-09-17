export const RESULTS_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>AIOStreams</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;width:100%;overflow:hidden;background-color:transparent !important;color-scheme:dark;font-family:system-ui,-apple-system,sans-serif;color:#e2e8f0;font-size:14px;-webkit-font-smoothing:antialiased}
.panel{position:absolute;inset:0;display:flex;flex-direction:column;background:#0a0a0a;border:1px solid rgba(255,255,255,0.08);border-radius:14px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.6),0 0 0 1px rgba(0,0,0,0.4);overflow:hidden;animation:slideIn .32s cubic-bezier(0.16,1,0.3,1) both}
.panel.is-leaving{animation:slideOut .24s cubic-bezier(0.7,0,0.84,0) both}
.panel.mobile{border-radius:16px 16px 0 0;box-shadow:0 -8px 32px rgba(0,0,0,0.5),0 0 0 1px rgba(0,0,0,0.4);animation:slideInUp .32s cubic-bezier(0.16,1,0.3,1) both}
.panel.mobile.is-leaving{animation:slideOutDown .24s cubic-bezier(0.7,0,0.84,0) both}
@keyframes slideIn{from{transform:translateX(60px);opacity:0}to{transform:translateX(0);opacity:1}}
@keyframes slideOut{from{transform:translateX(0);opacity:1}to{transform:translateX(60px);opacity:0}}
@keyframes slideInUp{from{transform:translateY(60px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes slideOutDown{from{transform:translateY(0);opacity:1}to{transform:translateY(60px);opacity:0}}
.hdr{display:flex;align-items:flex-start;gap:8px;padding:14px 14px 10px;border-bottom:1px solid rgba(255,255,255,0.07);flex-shrink:0}
.hdr-body{flex:1;min-width:0}
.hdr-row{display:flex;align-items:center;gap:8px}
.hdr-title{font-size:14px;font-weight:700;letter-spacing:.01em;color:#e2e8f0}

.hdr-sub{font-size:12px;color:rgba(255,255,255,0.38);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xbtn{background:none;border:none;color:rgba(255,255,255,0.3);cursor:pointer;padding:5px;border-radius:5px;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .12s,color .12s;margin-top:-2px}
.xbtn:hover{background:rgba(255,255,255,0.07);color:#e2e8f0}
.body{flex:1;overflow-y:auto;padding:10px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.1) transparent}
.center{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;min-height:220px;color:rgba(255,255,255,0.32);font-size:13px}
.spin{width:20px;height:20px;border:2px solid rgba(255,255,255,0.07);border-top-color:rgb(97,82,223);border-radius:50%;animation:sp .65s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
.err-txt{color:#f87171;text-align:center;max-width:86%;line-height:1.55;font-size:13px}
.card{border:1px solid rgba(255,255,255,0.07);border-radius:10px;background:rgba(255,255,255,0.022);margin-bottom:6px;overflow:hidden;transition:border-color .15s}
.card:hover{border-color:rgba(255,255,255,0.13)}
.card-top{padding:11px 12px 9px}
.card-name{font-size:15px;font-weight:500;line-height:1.45;color:#e2e8f0;white-space:pre-line;word-break:break-word}
.card-desc{font-size:14px;line-height:1.5;color:rgba(255,255,255,0.58);white-space:pre-line;word-break:break-word;margin-top:4px}
.card-actions{display:flex;gap:5px;padding:0 10px 10px}
.btn-p{flex:1;height:38px;border-radius:6px;border:none;font-size:15px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px;background:rgb(97,82,223);color:#fff;position:relative;overflow:hidden;transition:opacity .12s;font-family:inherit}
.btn-p:disabled{opacity:.5;cursor:not-allowed}
.btn-p:not(:disabled):hover{opacity:.82}
.btn-p .lbl{display:inline-flex;align-items:center;gap:7px}
.btn-p.loading .lbl{opacity:0}
.btn-p.loading::after{content:'';position:absolute;width:15px;height:15px;border:2px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:sp .6s linear infinite}
.btn-p.ext{background:rgba(8,110,146,.9)}
.btn-p.p2p{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#e2e8f0}
.btn-i{width:38px;height:38px;border-radius:6px;border:1px solid rgba(255,255,255,0.09);background:rgba(255,255,255,0.03);color:rgba(255,255,255,0.5);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .12s,color .12s}
.btn-i:hover{background:rgba(255,255,255,0.07);color:#e2e8f0}
.footer{display:none;align-items:center;justify-content:space-between;padding:12px 14px;border-top:1px solid rgba(255,255,255,0.07);background:rgba(255,255,255,0.015);flex-shrink:0}
.footer-time{font-size:12px;color:rgba(255,255,255,0.4)}
.footer-btn{display:none;align-items:center;gap:6px;padding:6px 12px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:#e2e8f0;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s}
.footer-btn:hover{background:rgba(255,255,255,0.1);border-color:rgba(255,255,255,0.2);color:#fff}
.footer-btn.err{background:rgba(248,113,113,0.1);border-color:rgba(248,113,113,0.2);color:#fca5a5}
.footer-btn.err:hover{background:rgba(248,113,113,0.15);border-color:rgba(248,113,113,0.3);color:#f87171}
.overlay{position:fixed;inset:0;background:#0a0a0a;display:flex;flex-direction:column;transform:translateY(100%);transition:transform .25s cubic-bezier(0.16,1,0.3,1)}
.overlay.open{transform:translateY(0)}
.ov-hdr{display:flex;align-items:center;justify-content:space-between;padding:14px 14px 10px;border-bottom:1px solid rgba(255,255,255,0.07);flex-shrink:0}
.ov-title{font-size:13px;font-weight:700}
.ov-body{flex:1;overflow-y:auto;padding:12px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.1) transparent}
.ov-sec{margin-bottom:16px}
.ov-sec-label{font-size:10px;font-weight:700;color:rgba(255,255,255,0.28);letter-spacing:.09em;text-transform:uppercase;margin-bottom:8px}
.ov-item{padding:9px 11px;border:1px solid rgba(255,255,255,0.06);border-radius:8px;margin-bottom:5px;background:rgba(255,255,255,0.018)}
.ov-item-title{font-size:15px;font-weight:500;color:#e2e8f0}
.ov-item-desc{font-size:14px;color:rgba(255,255,255,0.58);margin-top:4px;line-height:1.5;white-space:pre-line;word-break:break-word}
.ov-item.is-err .ov-item-title{color:#f87171}
.dl-pct{font-size:9px;font-weight:800;line-height:1;letter-spacing:-.02em}
.btn-i.dl-ok{color:#4ade80}.btn-i.dl-err{color:#f87171}
.btn-i:disabled{opacity:.55;cursor:not-allowed}
</style>
</head>
<body>

<div class="panel" id="panel">
<div class="hdr">
  <div class="hdr-body">
    <div class="hdr-row">
      <span class="hdr-title">AIOStreams</span>
    </div>
    <div id="sub" class="hdr-sub">Fetching streams...</div>
  </div>
  <div style="display:flex;align-items:center;gap:2px;flex-shrink:0;margin-top:-2px">
    <button class="xbtn" id="ref-btn" onclick="refresh_()" title="Refresh" style="display:none">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
    </button>
    <button class="xbtn" onclick="close_()">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>
</div>

<div class="body">
  <div id="loading" class="center"><div class="spin"></div><span>Fetching streams...</span></div>
  <div id="results" style="display:none"></div>
  <div id="empty" class="center" style="display:none">No streams found</div>
  <div id="err" class="center" style="display:none"><span class="err-txt" id="err-msg"></span><button class="btn-p" style="flex:none;width:auto;padding:0 20px;font-size:13px;height:34px;margin-top:4px" onclick="retry_()">Try Again</button></div>
</div>

<div class="footer" id="footer">
  <span class="footer-time" id="footer-time"></span>
  <button class="footer-btn" id="footer-btn" onclick="openOverlay()"></button>
</div>

<div class="overlay" id="overlay">
  <div class="ov-hdr">
    <span class="ov-title">Details</span>
    <button class="xbtn" onclick="closeOverlay()">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>
  <div class="ov-body" id="overlay-body"></div>
</div>

</div>

<script>
var W=window.webview,rs=[],playIdx=-1,_d={timeTakenMs:null,animeLookupMs:null,searchMs:null,fromCache:false,errors:[],statistics:[],lookup:null,sessionId:''},dlState={},_lastEpisodeInfo='';
function msg(v){if(typeof v!=='string')return v;try{return JSON.parse(v);}catch(e){return null;}}
function esc(s){if(!s&&s!==0)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function fmt(ms){return ms<1000?ms+'ms':(ms/1000).toFixed(1)+'s';}
function close_(){W.send('close',{});}
function retry_(){W.send('retry',{});}
function refresh_(){W.send('refresh',{});}
function updateDlBtn(i){var b=document.getElementById('dl-'+i);if(!b)return;var s=dlState[i];if(!s){b.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';b.disabled=false;b.className='btn-i';b.title='Download';return;}if(s.status==='downloading'){b.innerHTML='<span class="dl-pct">'+(s.percentage<1?'\u22ef':Math.round(s.percentage)+'%')+'</span>';b.disabled=true;b.className='btn-i';b.title=s.filename?'Downloading \u2014 '+s.filename:'Downloading...';return;}if(s.status==='completed'){b.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';b.disabled=false;b.className='btn-i dl-ok';b.title='Saved \u2014 '+s.filePath;return;}b.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/></svg>';b.disabled=false;b.className='btn-i dl-err';b.title=(s.error||'Download failed')+' \u2014 click to retry';}
function play(i){
  if(playIdx!==-1)return;playIdx=i;
  var b=document.getElementById('pb-'+i);
  if(b){b.disabled=true;b.classList.add('loading');}
  W.send('play',{index:i});
}
function openExt(i){
  var r=rs[i];
  if(r&&r.externalUrl) window.open(r.externalUrl, '_blank');
}
function copyStream(i){var r=rs[i];if(!r)return;var t=r.url||r.magnetLink||r.externalUrl||'';if(t)W.send('copy-stream',{text:t});}
function downloadStream(i){if(dlState[i]&&dlState[i].status==='downloading')return;W.send('download',{index:i});}
W.on('play-error',function(d){
  d=msg(d);
  var idx=d&&d.index!=null?d.index:playIdx;playIdx=-1;
  var b=document.getElementById('pb-'+idx);
  if(b){b.disabled=false;b.classList.remove('loading');}
});
W.on('download-progress',function(d){d=msg(d);if(d&&d.index!=null&&d.sessionId===_d.sessionId){dlState[d.index]=d;updateDlBtn(d.index);}});
function openOverlay(){
  var html='';
  var lk=_d.lookup;
  if(lk){
    html+='<div class="ov-sec"><div class="ov-sec-label">Lookup</div>';
    if(lk.original){
      html+='<div class="ov-item"><div class="ov-item-title">Original Media</div><div class="ov-item-desc">'+esc(lk.original)+'</div></div>';
    }
    if(lk.resolved){
      html+='<div class="ov-item"><div class="ov-item-title">Resolved Media</div><div class="ov-item-desc">'+esc(lk.resolved)+'</div></div>';
    }
    if(lk.stremioId){
      html+='<div class="ov-item"><div class="ov-item-title">Stremio ID</div><div class="ov-item-desc">'+esc(lk.stremioId)+'</div></div>';
    }
    html+='</div>';
  }
  if(_d.animeLookupMs!=null||_d.searchMs!=null||_d.fromCache){
    html+='<div class="ov-sec"><div class="ov-sec-label">Timing</div>';
    if(_d.animeLookupMs!=null){
      html+='<div class="ov-item"><div class="ov-item-title">Anime Lookup</div><div class="ov-item-desc">'+fmt(_d.animeLookupMs)+'</div></div>';
    }
    var searchDesc=_d.searchMs!=null?fmt(_d.searchMs):(_d.fromCache?'Served from cache':null);
    if(searchDesc){
      html+='<div class="ov-item"><div class="ov-item-title">Stream Search</div><div class="ov-item-desc">'+esc(searchDesc)+'</div></div>';
    }
    html+='</div>';
  }
  var errs=_d.errors||[];
  if(errs.length){
    html+='<div class="ov-sec"><div class="ov-sec-label">Errors ('+errs.length+')</div>';
    errs.forEach(function(e){html+='<div class="ov-item is-err"><div class="ov-item-title">'+esc(e.title)+'</div><div class="ov-item-desc">'+esc(e.description)+'</div></div>';});
    html+='</div>';
  }
  var stats=_d.statistics||[];
  if(stats.length){
    html+='<div class="ov-sec"><div class="ov-sec-label">Statistics</div>';
    stats.forEach(function(s){html+='<div class="ov-item"><div class="ov-item-title">'+esc(s.title)+'</div><div class="ov-item-desc">'+esc(s.description)+'</div></div>';});
    html+='</div>';
  }
  if(!html)html='<div class="center" style="min-height:120px">No details available</div>';
  document.getElementById('overlay-body').innerHTML=html;
  document.getElementById('overlay').classList.add('open');
}
function closeOverlay(){document.getElementById('overlay').classList.remove('open');}
function render(s){
  var L=document.getElementById('loading'),R=document.getElementById('results'),
      E=document.getElementById('empty'),ER=document.getElementById('err'),
      SB=document.getElementById('sub'),RB=document.getElementById('ref-btn'),
      FT=document.getElementById('footer'),FTT=document.getElementById('footer-time'),
      FB=document.getElementById('footer-btn');
  _d={timeTakenMs:s.timeTakenMs,animeLookupMs:s.animeLookupMs!=null?s.animeLookupMs:null,searchMs:s.searchMs!=null?s.searchMs:null,fromCache:!!s.fromCache,errors:s.errors||[],statistics:s.statistics||[],lookup:s.lookup||null,sessionId:s.sessionId||''};
  if(s.episodeInfo)SB.textContent=s.episodeInfo;
  if(s.loading){
    L.style.display='flex';R.style.display='none';E.style.display='none';
    ER.style.display='none';FT.style.display='none';if(RB)RB.style.display='none';
    var lt=L.querySelector('span');if(lt)lt.textContent='Fetching streams\u2026';
    return;
  }
  if(s.autoPlay&&!s.error&&s.results&&s.results.length>0){
    var lt2=L.querySelector('span');if(lt2)lt2.textContent='Starting playback\u2026';
    L.style.display='flex';R.style.display='none';E.style.display='none';
    ER.style.display='none';FT.style.display='none';if(RB)RB.style.display='none';
    return;
  }
  L.style.display='none';
  closeOverlay();
  var showFooter=s.timeTakenMs!=null||(s.errors&&s.errors.length>0)||(s.statistics&&s.statistics.length>0)||!!s.lookup;
  if(showFooter){
    FT.style.display='flex';
    var rc=s.results?s.results.length:0;FTT.textContent=s.timeTakenMs!=null?(s.fromCache?'Cached':'Fetched')+' '+rc+' result'+(rc!==1?'s':'')+' in '+fmt(s.timeTakenMs):'';
    var ec=s.errors?s.errors.length:0,sc=s.statistics?s.statistics.length:0;
    var parts=[];
    if(ec>0)parts.push(ec+' error'+(ec!==1?'s':''));
    if(sc>0)parts.push(sc+' stat'+(sc!==1?'s':''));
    if(!parts.length&&s.timeTakenMs!=null)parts.push('Details');
    if(parts.length){
      FB.style.display='flex';FB.textContent=parts.join(' \u00b7 ')+' \u203a';
      FB.className='footer-btn'+(ec>0?' err':'');
    } else {
      FB.style.display='none';
    }
  } else {
    FT.style.display='none';
  }
  if(s.error){
    ER.style.display='flex';document.getElementById('err-msg').textContent=s.error;
    R.style.display='none';E.style.display='none';
    return;
  }
  ER.style.display='none';if(RB)RB.style.display='flex';
  rs=s.results||[];playIdx=-1;if(s.episodeInfo&&s.episodeInfo!==_lastEpisodeInfo){dlState={};_lastEpisodeInfo=s.episodeInfo;}
  if(rs.length===0){E.style.display='flex';R.style.display='none';return;}
  E.style.display='none';
  var COPY='<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  var DL='<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  var PLAY='<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
  var EXT='<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
  var html='';
  for(var i=0;i<rs.length;i++){
    var r=rs[i];
    var URL_TYPES=['http','usenet','debrid','live','info'];
    var acts='';
    if(URL_TYPES.indexOf(r.type)!==-1){
      acts='<button class="btn-p" id="pb-'+i+'" onclick="play('+i+')"><span class="lbl">'+PLAY+' Play</span></button>';
      acts+='<button class="btn-i" onclick="copyStream('+i+')" title="Copy URL">'+COPY+'</button>';
      acts+='<button class="btn-i" id="dl-'+i+'" onclick="downloadStream('+i+')" title="Download">'+DL+'</button>';
    }else if(r.type==='p2p'){
      acts='<button class="btn-p" id="pb-'+i+'" onclick="play('+i+')"><span class="lbl">'+PLAY+' Play</span></button>';
      if(r.magnetLink)acts+='<button class="btn-i" onclick="copyStream('+i+')" title="Copy Magnet">'+COPY+'</button>';
    }else if(r.type==='external'){
      acts='<button class="btn-p ext" onclick="openExt('+i+')"><span class="lbl">'+EXT+' Open in Browser</span></button>';
      if(r.externalUrl)acts+='<button class="btn-i" onclick="copyStream('+i+')" title="Copy URL">'+COPY+'</button>';
    }else{
      acts='<div style="color:#f87171;background:rgba(248,113,113,0.1);border:1px dashed rgba(248,113,113,0.3);border-radius:6px;padding:5px 0;font-size:12px;text-align:center;width:100%">Unsupported stream format</div>';
    }
    html+='<div class="card"><div class="card-top">';
    if(r.name)html+='<div class="card-name">'+esc(r.name)+'</div>';
    if(r.description)html+='<div class="card-desc">'+esc(r.description)+'</div>';
    html+='</div>';
    if(acts)html+='<div class="card-actions">'+acts+'</div>';
    html+='</div>';
  }
  R.innerHTML=html;R.style.display='block';
}
W.on('state',function(s){
  s=msg(s);if(!s)return;
  var p=document.getElementById('panel');
  if(p) p.classList.remove('is-leaving');
  render(s);
});
W.on('close-anim',function(){var p=document.getElementById('panel');if(p)p.classList.add('is-leaving');});
W.on('mobile-mode',function(m){m=msg(m);var p=document.getElementById('panel');if(!p)return;if(m)p.classList.add('mobile');else p.classList.remove('mobile');});
document.addEventListener('keydown',function(e){if(e.key==='Escape'){if(document.getElementById('overlay').classList.contains('open')){closeOverlay();}else{close_();}}});
</script>
</body>
</html>`;
