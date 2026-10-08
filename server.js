import express from 'express';
import crypto from 'node:crypto';

const app=express();
const port=process.env.PORT||3000;
app.use(express.json({limit:'2mb'}));
app.use(express.static('public'));

const rooms=new Map();

const cards=[
  ['Fork Bomb','BOOM','bomb'],['Fork Bomb','BOOM','bomb'],['Fork Bomb','BOOM','bomb'],
  ['Shield','BLOCK','shield'],['Shield','BLOCK','shield'],['Shield','BLOCK','shield'],['Shield','BLOCK','shield'],
  ['Deflect','TURN','deflect'],['Deflect','TURN','deflect'],['Deflect','TURN','deflect'],
  ['Peek','SCAN','peek'],['Peek','SCAN','peek'],['Peek','SCAN','peek'],
  ['Steal','GRAB','steal'],['Steal','GRAB','steal'],['Steal','GRAB','steal'],
  ['Skip','PASS','skip'],['Skip','PASS','skip'],['Skip','PASS','skip'],
  ['Double Turn','2X','double'],['Double Turn','2X','double'],
  ['Lucky Fork','LUCK','lucky'],['Lucky Fork','LUCK','lucky'],['Lucky Fork','LUCK','lucky'],
  ['Safe Bite','SAFE','safe'],['Safe Bite','SAFE','safe']
];

function deckFor(count){
  const base=cards.map(([name,label,type])=>({id:crypto.randomUUID(),name,label,type}));
  const bombs=base.filter(c=>c.type==='bomb');
  const safe=base.filter(c=>c.type!=='bomb');
  for(let i=base.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[base[i],base[j]]=[base[j],base[i]];}
  return base.slice(0,Math.max(0,count)).map(c=>({...c}));
}
function publicState(room){
  return {
    code:room.code,started:room.started,turn:room.turn,round:room.round,winner:room.winner,
    players:room.players.map(p=>({id:p.id,name:p.name,hand:p.hand.map(c=>({id:c.id,name:c.name,label:c.label,type:c.type}))})),
    log:room.log.slice(-30),
    deckCount:room.deck.length,
    top:room.deck.length?{name:'Mystery Fork',label:'?',type:'mystery'}:null
  };
}
function addLog(room,text){room.log.push({id:crypto.randomUUID(),text,at:Date.now()});}
function nextTurn(room,steps=1){
  if(!room.players.length)return;
  for(let i=0;i<steps;i++) room.turn=(room.turn+1)%room.players.length;
  room.round++;
}
function refill(room){
  if(room.discard.length){
    room.deck=room.discard.splice(0).map(c=>({...c,id:crypto.randomUUID()}));
    for(let i=room.deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[room.deck[i],room.deck[j]]=[room.deck[j],room.deck[i]];}
  }
}
function draw(room,p){
  if(!room.deck.length)refill(room);
  if(room.deck.length)p.hand.push(room.deck.pop());
}
function startGame(room){
  room.started=true; room.round=1; room.turn=0; room.winner=null;
  room.deck=deckFor(Math.max(20,room.players.length*8));
  room.discard=[];
  room.players.forEach(p=>p.hand=[]);
  room.players.forEach(p=>{for(let i=0;i<5;i++)draw(room,p);});
  // Put exactly one bomb into the live deck per player, with the rest already shuffled.
  room.deck.push(...Array.from({length:Math.max(1,room.players.length-1)},()=>({id:crypto.randomUUID(),name:'Fork Bomb',label:'BOOM',type:'bomb'})));
  for(let i=room.deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[room.deck[i],room.deck[j]]=[room.deck[j],room.deck[i]];}
  addLog(room,'Game started. Keep your fork steady.');
}
app.post('/api/rooms',(req,res)=>{
  const code=Math.random().toString(36).slice(2,6).toUpperCase();
  const id=crypto.randomUUID();
  rooms.set(code,{code,host:id,started:false,turn:0,round:0,winner:null,players:[],deck:[],discard:[],log:[]});
  res.json({code,id});
});
app.post('/api/rooms/:code/join',(req,res)=>{
  const room=rooms.get(req.params.code.toUpperCase());
  if(!room)return res.status(404).json({error:'Room not found.'});
  if(room.started)return res.status(409).json({error:'That game already started.'});
  if(room.players.length>=6)return res.status(409).json({error:'Room is full.'});
  const name=String(req.body?.name||'Player').trim().slice(0,20);
  if(!name)return res.status(400).json({error:'Enter a name.'});
  const id=crypto.randomUUID();
  room.players.push({id,name,hand:[]});
  addLog(room, name+' joined the table.');
  res.json({id,state:publicState(room)});
});
app.get('/api/rooms/:code',(req,res)=>{
  const room=rooms.get(req.params.code.toUpperCase());
  if(!room)return res.status(404).json({error:'Room not found.'});
  res.json(publicState(room));
});
app.post('/api/rooms/:code/start',(req,res)=>{
  const room=rooms.get(req.params.code.toUpperCase());
  if(!room)return res.status(404).json({error:'Room not found.'});
  if(room.players.length<2)return res.status(400).json({error:'You need at least 2 players.'});
  if(room.started)return res.json(publicState(room));
  startGame(room);res.json(publicState(room));
});
app.post('/api/rooms/:code/draw',(req,res)=>{
  const room=rooms.get(req.params.code.toUpperCase());
  if(!room||!room.started)return res.status(400).json({error:'Game is not active.'});
  const p=room.players.find(x=>x.id===req.body?.playerId);
  if(!p)return res.status(404).json({error:'Player not found.'});
  if(room.players[room.turn]?.id!==p.id)return res.status(400).json({error:'Wait for your turn.'});
  draw(room,p);
  const c=p.hand[p.hand.length-1];
  if(!c)return res.status(400).json({error:'No cards left.'});
  if(c.type==='bomb'){
    const shield=p.hand.findIndex(x=>x.type==='shield');
    if(shield>=0){
      const saved=p.hand.splice(shield,1)[0];
      p.hand.pop(); room.discard.push(c);
      addLog(room,p.name+' found a Fork Bomb and used a Shield.');
      // Put bomb back somewhere random in the deck.
      const at=Math.floor(Math.random()*(room.deck.length+1));room.deck.splice(at,0,{...c,id:crypto.randomUUID()});
    }else{
      p.hand.pop();room.discard.push(c);
      addLog(room,p.name+' hit the Fork Bomb and is out.');
      room.players.splice(room.turn,1);
      if(room.players.length===1){room.winner=room.players[0].name;room.started=false;addLog(room,room.winner+' wins the fork!');}
      else if(room.turn>=room.players.length)room.turn=0;
      res.json(publicState(room));return;
    }
  }else{
    addLog(room,p.name+' drew '+c.name+'.');
    room.discard.push(c);
  }
  nextTurn(room,1);
  res.json(publicState(room));
});
app.post('/api/rooms/:code/play',(req,res)=>{
  const room=rooms.get(req.params.code.toUpperCase());
  if(!room||!room.started)return res.status(400).json({error:'Game is not active.'});
  const p=room.players.find(x=>x.id===req.body?.playerId);
  if(!p||room.players[room.turn]?.id!==p.id)return res.status(400).json({error:'Not your turn.'});
  const idx=p.hand.findIndex(c=>c.id===req.body?.cardId);
  if(idx<0)return res.status(404).json({error:'Card not found.'});
  const c=p.hand.splice(idx,1)[0];
  if(c.type==='shield'||c.type==='bomb')return res.status(400).json({error:'That card is reactive or drawn automatically.'});
  room.discard.push(c);
  if(c.type==='skip'){addLog(room,p.name+' played Skip.');nextTurn(room,1);}
  else if(c.type==='double'){addLog(room,p.name+' played Double Turn.');nextTurn(room,2);}
  else if(c.type==='peek'){addLog(room,p.name+' scanned the mystery fork.');}
  else if(c.type==='deflect'){addLog(room,p.name+' deflected the danger.');nextTurn(room,2);}
  else if(c.type==='steal'){
    const target=room.players[(room.turn+1)%room.players.length];
    if(target?.hand.length){const i=Math.floor(Math.random()*target.hand.length);p.hand.push(target.hand.splice(i,1)[0]);addLog(room,p.name+' grabbed a card from '+target.name+'.');}
    else addLog(room,p.name+' tried to grab a card, but found nothing.');
  } else if(c.type==='lucky'){
    draw(room,p);addLog(room,p.name+' took a Lucky Fork draw.');nextTurn(room,1);
  } else if(c.type==='safe'){addLog(room,p.name+' played Safe Bite.');}
  res.json(publicState(room));
});
app.use((_req,res)=>res.sendFile(process.cwd()+'/public/index.html'));
app.listen(port,()=>console.log('Exploding Fork listening on '+port));
