(function(){
var DAY0=420,DAY1=1320,NOW=1025;
var CARDS={
  'SKYNET-71':'Webhook retry backoff',
  'LAI-860':'Agent dispatch: onboarding epic',
  'LAI-864':'Board column drag performance',
  'LAI-866':'Signals collector: commit hooks',
  'LAI-867':'Timeline zoom presets',
  'LAI-307':'Self-host upgrade script',
  'GENERAL':'General'
};
var YOU=[
  {id:'b0',state:'idle',start:420,end:581},
  {id:'b1',state:'needs',start:581,end:660,hint:'Prompts in laika/api, no card named'},
  {id:'b2',state:'break',start:660,end:670},
  {id:'b3',state:'confirmed',card:'SKYNET-71',start:670,end:719},
  {id:'b4',state:'gap',start:719,end:724},
  {id:'b5',state:'break',start:724,end:750,label:'Lunch'},
  {id:'g1',state:'group',start:750,end:810,subs:[
    {id:'s1',state:'confirmed',card:'LAI-860',start:750,end:810,track:0},
    {id:'s2',state:'drafted',card:'LAI-866',start:755,end:795,track:1},
    {id:'s3',state:'drafted',card:'SKYNET-71',start:770,end:810,track:2}]},
  {id:'b6',state:'gap',start:810,end:820},
  {id:'b7',state:'drafted',card:'GENERAL',start:820,end:825},
  {id:'b8',state:'drafted',card:'LAI-867',start:825,end:865},
  {id:'b9',state:'needs',start:865,end:872,hint:'Commits on a branch with no card'},
  {id:'b10',state:'confirmed',card:'LAI-864',start:872,end:910},
  {id:'b11',state:'notwork',start:910,end:920},
  {id:'b12',state:'drafted',card:'LAI-307',start:920,end:990},
  {id:'b13',state:'gap',start:990,end:1010},
  {id:'b14',state:'drafted',card:'LAI-860',start:1010,end:1025,live:true},
  {id:'b15',state:'future',start:1025,end:1320}
];
var LUNCH={start:720,end:780};
var GROUP=YOU.filter(function(b){return b.subs;})[0];
var AGENTS=[
  {id:'a1',agent:'kepler',card:'SKYNET-71',start:675,end:712},
  {id:'a2',agent:'kepler',card:'LAI-864',start:740,end:830},
  {id:'a3',agent:'lyra',card:'LAI-866',start:755,end:800},
  {id:'a4',agent:'vega',card:'LAI-867',start:765,end:870},
  {id:'a5',agent:'orion',card:'LAI-860',start:750,end:795},
  {id:'a6',agent:'nova',card:'LAI-307',start:770,end:845},
  {id:'a7',agent:'nova',card:'LAI-307',start:925,end:985},
  {id:'a8',agent:'orion',card:'LAI-860',start:1012,end:1025,live:true}
];
function rnd(t,k){var x=Math.sin(t*12.9898+k*78.233)*43758.5453;return x-Math.floor(x);}
function stateAt(t){for(var i=0;i<YOU.length;i++){var b=YOU[i];if(t>=b.start&&t<b.end)return b.state;}return 'idle';}
var SIG=[];
for(var t=580;t<1025;t+=5){
  var s=stateAt(t+2.5),p=0,c=0,m=0,r1=rnd(t,1),r2=rnd(t,2),r3=rnd(t,3);
  if(s==='needs'){p=1+Math.floor(r1*4);m=r3>0.88?1:0;}
  else if(s==='confirmed'){p=Math.floor(r1*3);c=r2>0.6?1:0;m=r3>0.8?1:0;}
  else if(s==='group'){p=2+Math.floor(r1*4);c=r2>0.72?1:0;m=r3>0.68?1:0;}
  else if(s==='drafted'){p=Math.floor(r1*2.6);c=r2>0.55?(r2>0.93?2:1):0;m=r3>0.86?1:0;}
  if(p||c||m)SIG.push({t:t,p:p,c:c,m:m});
}
function fmt(t,ap){var h=Math.floor(t/60),mm=Math.round(t%60);if(mm===60){h++;mm=0;}var a=(h%24)>=12?'PM':'AM';var hh=h%12;if(hh===0)hh=12;return hh+':'+(mm<10?'0':'')+mm+(ap===false?'':' '+a);}
function rng(a,b){var A=a>=720?'PM':'AM',B=b>=720?'PM':'AM';return A===B?fmt(a,false)+' – '+fmt(b):fmt(a)+' – '+fmt(b);}
function dur(m){m=Math.round(m);var h=Math.floor(m/60),r=m%60;return h?(r?h+'h '+(r<10?'0':'')+r+'m':h+'h'):r+'m';}
function hourLabel(h){var hh=h%12||12;return hh+(h%24<12?' AM':' PM');}
function sigIn(a,b){var r={p:0,c:0,m:0};SIG.forEach(function(s){var c=s.t+2.5;if(c>=a&&c<b){r.p+=s.p;r.c+=s.c;r.m+=s.m;}});return r;}
function agentsDuring(a,b){return AGENTS.filter(function(x){return x.start<b&&x.end>a;}).map(function(x){return Object.assign({},x,{ov:Math.min(b,x.end)-Math.max(a,x.start)});});}
function evenShares(g){var r={};g.subs.forEach(function(s){r[s.id]=0;});for(var t=g.start;t<g.end;t++){var act=g.subs.filter(function(s){return t>=s.start&&t<s.end;});act.forEach(function(s){r[s.id]+=1/act.length;});}return r;}
function concAt(items,t){return items.filter(function(x){return t>=x.start&&t<x.end;}).length;}
function clusters(){
  var ags=AGENTS.slice().sort(function(a,b){return a.start-b.start;}),out=[];
  ags.forEach(function(a){var c=out[out.length-1];if(c&&a.start<c.end){c.items.push(a);c.end=Math.max(c.end,a.end);}else out.push({start:a.start,end:a.end,items:[a]});});
  out.forEach(function(c,i){c.id='c'+i;var mx=0;for(var t=c.start;t<c.end;t++)mx=Math.max(mx,concAt(c.items,t));c.max=mx;});
  return out;
}
function pack(items){var ends=[];return items.slice().sort(function(a,b){return a.start-b.start;}).map(function(x){var k=0;while(k<ends.length&&ends[k]>x.start)k++;ends[k]=x.end;return Object.assign({},x,{track:k});});}
function buildScale(o){
  var a=o.range?o.range[0]:DAY0,b=o.range?o.range[1]:DAY1,segs=[];
  if(o.linear){segs=[{t0:a,t1:b,p0:0,p1:(b-a)*o.k}];}
  else{
    var iv=[];
    YOU.forEach(function(bk){var s=Math.max(bk.start,a),e=Math.min(bk.end,b);if(e<=s)return;var idle=bk.state==='idle'||bk.state==='future';
      iv.push({t0:s,t1:e,comp:!!o.compress&&idle&&e-s>=45,min:idle?0:(bk.state==='group'?o.groupMin:o.min),state:bk.state});});
    var compSum=iv.filter(function(i){return i.comp;}).length*o.compW,k=o.k||1,pinned=[];
    var isP=function(i){return pinned.indexOf(i)>=0;};
    if(o.fitLength){for(var it=0;it<10;it++){var pin=0,ds=0;iv.forEach(function(i){if(i.comp)return;if(isP(i))pin+=i.min;else ds+=i.t1-i.t0;});k=(o.fitLength-compSum-pin)/Math.max(1,ds);var ch=false;iv.forEach(function(i){if(!i.comp&&!isP(i)&&(i.t1-i.t0)*k<i.min){pinned.push(i);ch=true;}});if(!ch)break;}}
    else iv.forEach(function(i){if(!i.comp&&(i.t1-i.t0)*k<i.min)pinned.push(i);});
    var p=0;segs=iv.map(function(i){var len=i.comp?o.compW:isP(i)?i.min:(i.t1-i.t0)*k;var s={t0:i.t0,t1:i.t1,p0:p,p1:p+len,comp:i.comp,state:i.state};p+=len;return s;});
    if(o.fitLength&&p>o.fitLength){var f=o.fitLength/p;segs.forEach(function(s){s.p0*=f;s.p1*=f;});}
  }
  var total=segs[segs.length-1].p1;
  function pos(t){if(t<=segs[0].t0)return 0;for(var i=0;i<segs.length;i++){var s=segs[i];if(t<=s.t1)return s.p0+(t-s.t0)/(s.t1-s.t0)*(s.p1-s.p0);}return total;}
  function at(p){for(var i=0;i<segs.length;i++){var s=segs[i];if(p<=s.p1)return s.t0+(p-s.p0)/Math.max(1e-6,s.p1-s.p0)*(s.t1-s.t0);}return b;}
  function inComp(t){return segs.some(function(s){return s.comp&&t>s.t0&&t<s.t1;});}
  return {segs:segs,total:total,pos:pos,at:at,a:a,b:b,inComp:inComp};
}
var STY={
  light:{
    confirmed:{bg:'#7c3aed',border:'1px solid #6d28d9',color:'#ffffff',sub:'#ede9fe',chip:'rgba(255,255,255,.22)',icon:'✓',name:'Confirmed'},
    drafted:{bg:'#f7f3ff',border:'1.5px dashed #8b5cf6',color:'#4c1d95',sub:'#5b21b6',chip:'#e9e0fe',icon:'✎',name:'Drafted'},
    needs:{bg:'repeating-linear-gradient(135deg,#fff4de 0 6px,#fde4b6 6px 12px)',border:'1px solid #d97706',color:'#78350f',sub:'#7c3f0a',chip:'#fbd38d',icon:'?',name:'Needs a card'},
    gap:{bg:'#ffffff',border:'1.5px dotted #8e8e9c',color:'#45454f',sub:'#5d5d69',chip:'#efeff4',icon:'+',name:'Gap'},
    break:{bg:'#e7f4ec',border:'1px solid #8fcca8',color:'#1d5e3c',sub:'#2a6b49',chip:'#cdeadb',icon:'‖',name:'Break'},
    notwork:{bg:'repeating-linear-gradient(45deg,#e6e6ec 0 2px,#f6f6f9 2px 7px)',border:'1px solid #bdbdc8',color:'#3f3f4a',sub:'#4f4f5b',chip:'#e2e2e9',icon:'×',name:'Not work'}
  },
  dark:{
    confirmed:{bg:'#7c3aed',border:'1px solid #9f75fa',color:'#ffffff',sub:'#ede9fe',chip:'rgba(255,255,255,.2)',icon:'✓',name:'Confirmed'},
    drafted:{bg:'#221a37',border:'1.5px dashed #a78bfa',color:'#ebe4ff',sub:'#cbbcff',chip:'#35295c',icon:'✎',name:'Drafted'},
    needs:{bg:'repeating-linear-gradient(135deg,#2b2011 0 6px,#3a2a10 6px 12px)',border:'1px solid #f59e0b',color:'#fde0a8',sub:'#f5cd85',chip:'#4f3810',icon:'?',name:'Needs a card'},
    gap:{bg:'#1a1a21',border:'1.5px dotted #74748a',color:'#cfcfd9',sub:'#ababb7',chip:'#2a2a33',icon:'+',name:'Gap'},
    break:{bg:'#12281c',border:'1px solid #2f7350',color:'#a3e6c1',sub:'#8fd4ae',chip:'#1d3d2b',icon:'‖',name:'Break'},
    notwork:{bg:'repeating-linear-gradient(45deg,#2a2a33 0 2px,#1c1c23 2px 7px)',border:'1px solid #4e4e5a',color:'#c8c8d2',sub:'#b0b0bc',chip:'#30303a',icon:'×',name:'Not work'}
  }
};
var TOK={
  light:{page:'#f1f1f6',card:'#ffffff',border:'#e4e4ec',rule:'#ececf2',grid:'#f0f0f5',ink:'#16161d',ink2:'#3f3f4a',muted:'#62626e',faint:'#9a9aa6',chip:'#f4f4f8',chipBorder:'#e3e3ea',btn:'#ffffff',accent:'#7c3aed',accentInk:'#6d28d9',accentSoft:'#f3eefe',now:'#d4283d',focus:'#0b6bcb',hl:'rgba(124,58,237,.10)',lift:'rgba(22,22,29,.18)',comp:'repeating-linear-gradient(135deg,#f7f7fa 0 5px,#efeff4 5px 10px)',future:'#fafafc',shadow:'0 1px 2px rgba(22,22,29,.05)',tipBg:'#16161d',tipInk:'#f4f4f8',tipMuted:'#b9b9c6',tipRule:'#2e2e38',selRing:'#16161d',sig:{p:'#45454f',c:'#0f766e',m:'#b45309'},agent:{bg:'#eef1f5',bg2:'#e4e9f0',border:'#c3ccd8',ink:'#232c3a',sub:'#465163',spark:'#8b9ab0',chip:'#dde3eb'}},
  dark:{page:'#111116',card:'#1a1a21',border:'#2b2b35',rule:'#272730',grid:'#212129',ink:'#ececf2',ink2:'#cacad4',muted:'#a0a0ac',faint:'#6f6f7c',chip:'#23232b',chipBorder:'#33333e',btn:'#1f1f27',accent:'#8b5cf6',accentInk:'#c4b5fd',accentSoft:'#2a2140',now:'#f0566a',focus:'#5cb3ff',hl:'rgba(167,139,250,.14)',lift:'rgba(0,0,0,.5)',comp:'repeating-linear-gradient(135deg,#1d1d25 0 5px,#23232c 5px 10px)',future:'#17171d',shadow:'none',tipBg:'#f4f4f8',tipInk:'#16161d',tipMuted:'#55555f',tipRule:'#dcdce4',selRing:'#ffffff',sig:{p:'#cacad4',c:'#2dd4bf',m:'#fbbf24'},agent:{bg:'#1f2530',bg2:'#252c39',border:'#3d4a5e',ink:'#dfe6f0',sub:'#aab7c9',spark:'#6b7a91',chip:'#2e3747'}}
};
function units(ov){var u=[];YOU.forEach(function(b){if(b.state==='idle'||b.state==='future')return;if(b.subs)b.subs.forEach(function(s){u.push(Object.assign({},s,ov[s.id]||{},{group:b.id}));});else u.push(Object.assign({},b,ov[b.id]||{}));});return u;}
function totals(ov,shares){var r={confirmed:0,drafted:0,needs:0,gap:0,break:0,notwork:0};units(ov).forEach(function(u){var d=u.group?shares[u.id]:u.end-u.start;r[u.state]=(r[u.state]||0)+d;});return r;}
function suggestions(u,all){
  var out=[];var add=function(c,why){if(c&&out.every(function(o){return o.card!==c;}))out.push({card:c,why:why});};
  agentsDuring(u.start-15,u.end+15).forEach(function(a){add(a.card,a.agent+' was building it');});
  var i=all.findIndex(function(x){return x.id===u.id;});
  var prev=all.slice(0,i).reverse().find(function(x){return x.card;}),next=all.slice(i+1).find(function(x){return x.card;});
  if(prev)add(prev.card,'Card before');if(next)add(next.card,'Card after');
  return out.slice(0,3);
}
function counts(c){var p=function(n,w){return n+' '+w+(n===1?'':'s');};return p(c.p,'prompt')+' · '+p(c.c,'commit')+' · '+p(c.m,'mark');}
window.LaikaTL={LUNCH:LUNCH,counts:counts,DAY0:DAY0,DAY1:DAY1,NOW:NOW,CARDS:CARDS,YOU:YOU,GROUP:GROUP,AGENTS:AGENTS,SIG:SIG,fmt:fmt,rng:rng,dur:dur,hourLabel:hourLabel,sigIn:sigIn,agentsDuring:agentsDuring,evenShares:evenShares,clusters:clusters,pack:pack,concAt:concAt,buildScale:buildScale,styles:function(th){return STY[th];},tokens:TOK,units:units,totals:totals,suggestions:suggestions};
})();
