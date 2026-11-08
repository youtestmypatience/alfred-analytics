/* Alfred Analytics · optional Supabase account and conflict-safe per-topic sync. */
(()=>{'use strict';
  const config=window.DV_SUPABASE_CONFIG||{};
  const enabled=Boolean(config.url && config.publishableKey);
  const BASE='alfred-dv-v1', ACTIVE='alfred-dv-active-user';
  const allTopics=new Set((window.DV_MODULES||[]).flatMap(m=>m.sections.map(s=>`${m.num}:${s.id}`)));
  const query=(selector,parent=document)=>parent.querySelector(selector);
  let client=null, user=null, lastKnown=null, uploadTimer=null, uploading=false;

  function notify(text){
    const div=document.createElement('div');div.className='toast';div.textContent=text;
    document.body.append(div);setTimeout(()=>div.remove(),4600);
  }
  function safeState(value){
    const s=value&&typeof value==='object'?value:{};
    const completed=Object.fromEntries(Object.entries(s.completed||{}).filter(([id,v])=>allTopics.has(id)&&v===true));
    const reading=Object.fromEntries(Object.entries(s.reading||{}).filter(([num,p])=>/^([1-9]|1[0-2])$/.test(num)&&Number.isFinite(Number(p))).map(([num,p])=>[num,Math.max(0,Math.min(100,Number(p)))]));
    const last=s.last&&Number.isInteger(Number(s.last.module))&&allTopics.has(`${s.last.module}:${s.last.topic}`)
      ?{module:Number(s.last.module),topic:s.last.topic,title:String(s.last.title||'').slice(0,200)}:null;
    return {completed,reading,last,theme:s.theme==='light'?'light':'dark'};
  }
  const userKey=id=>`${BASE}:user:${id}`;
  const queueKey=id=>`${BASE}:pending:${id}`;
  function readJSON(key){try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}}
  function readState(key){return safeState(readJSON(key))}
  function writeState(key,state){localStorage.setItem(key,JSON.stringify(safeState(state)))}
  function readQueue(id){
    const q=readJSON(queueKey(id))||{};
    return {
      topics:Object.fromEntries(Object.entries(q.topics||{}).filter(([k,v])=>allTopics.has(k)&&typeof v==='boolean')),
      reading:Object.fromEntries(Object.entries(q.reading||{}).filter(([k,v])=>/^([1-9]|1[0-2])$/.test(k)&&v&&typeof v==='object'))
    };
  }
  function saveQueue(q){if(user)localStorage.setItem(queueKey(user.id),JSON.stringify(q))}
  function hasQueue(q){return Object.keys(q.topics).length>0||Object.keys(q.reading).length>0}
  function setLabel(){const button=query('#auth');if(button)button.textContent=user?'☁ Аккаунт':'Войти';}
  function openDialog(){
    const shade=document.createElement('div');shade.className='auth-shade';shade.setAttribute('role','presentation');
    shade.innerHTML='<section class="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-heading"><div class="auth-row"><h2 id="auth-heading">Мой прогресс</h2><button class="auth-x" type="button" aria-label="Закрыть">×</button></div><div id="auth-contents"></div></section>';
    document.body.append(shade);document.body.classList.add('auth-open');
    const close=()=>{shade.remove();document.body.classList.remove('auth-open')};
    query('.auth-x',shade).onclick=close;
    shade.onclick=e=>{if(e.target===shade)close()};
    shade.onkeydown=e=>{if(e.key==='Escape')close()};
    query('.auth-dialog',shade).tabIndex=-1;query('.auth-dialog',shade).focus();
    return {shade,close,render:html=>{query('#auth-contents',shade).innerHTML=html}};
  }
  function showDisabled(d){d.render('<p>Все 12 модулей доступны без регистрации. Прогресс сохраняется в этом браузере.</p><div class="auth-note">Облачные аккаунты пока не активированы администратором. Гостевой режим продолжает работать.</div>')}
  function showGuest(d){
    d.render(`<p>Войдите для синхронизации между устройствами или продолжайте пользоваться сайтом без регистрации.</p><div class="auth-tabs"><button type="button" class="btn" id="auth-signin">Войти</button><button type="button" class="btn" id="auth-signup">Регистрация</button></div><form id="auth-form"><label>Email<input id="auth-email" type="email" autocomplete="email" required maxlength="240"></label><label>Пароль<input id="auth-password" type="password" autocomplete="current-password" required minlength="8" maxlength="128"></label><button class="primary" id="auth-submit" type="submit">Войти</button><div id="auth-status" aria-live="polite"></div></form><div class="auth-note">При регистрации может потребоваться подтверждение email. Никто не обязан создавать аккаунт для чтения материалов.</div>`);
    let mode='signin';
    function switchMode(next){mode=next;query('#auth-submit',d.shade).textContent=mode==='signup'?'Зарегистрироваться':'Войти';query('#auth-password',d.shade).autocomplete=mode==='signup'?'new-password':'current-password'}
    query('#auth-signin',d.shade).onclick=()=>switchMode('signin');
    query('#auth-signup',d.shade).onclick=()=>switchMode('signup');
    query('#auth-form',d.shade).onsubmit=async event=>{
      event.preventDefault();
      const submit=query('#auth-submit',d.shade),status=query('#auth-status',d.shade);
      submit.disabled=true;status.className='auth-spinner';status.textContent='Выполняется запрос…';
      try{
        const email=query('#auth-email',d.shade).value.trim();
        const password=query('#auth-password',d.shade).value;
        const result=mode==='signup'
          ?await client.auth.signUp({email,password,options:{emailRedirectTo:location.origin+location.pathname}})
          :await client.auth.signInWithPassword({email,password});
        if(result.error)throw result.error;
        if(!result.data.session){status.className='auth-success';status.textContent='Проверьте электронную почту, подтвердите аккаунт и затем войдите.';return}
        d.close();await beginSession(result.data.session.user,{offerGuestImport:true});
      }catch(error){status.className='auth-error';status.textContent=error.message||'Ошибка авторизации'}finally{submit.disabled=false}
    };
  }
  function showAccount(d){
    d.render(`<p>Вы вошли: <strong id="auth-who"></strong></p><div class="auth-note">Отметки синхронизируются по отдельным темам. Пока соединение недоступно, изменения остаются в локальном кеше этого аккаунта.</div><div style="display:grid;gap:10px;margin-top:18px"><button class="btn" id="auth-sync" type="button">Синхронизировать сейчас</button><button class="btn" id="auth-import-guest" type="button">Добавить отметки из гостевого режима</button><button class="btn" id="auth-logout" type="button">Выйти и перейти в гостевой режим</button></div><p class="dim" id="auth-status" aria-live="polite"></p>`);
    query('#auth-who',d.shade).textContent=user.email||'Пользователь';
    query('#auth-sync',d.shade).onclick=async()=>{
      const status=query('#auth-status',d.shade);status.textContent='Синхронизация…';
      const ok=await syncNow();status.textContent=ok?'Прогресс синхронизирован':'Облачная синхронизация недоступна. Локальные отметки сохранены.';
    };
    query('#auth-import-guest',d.shade).onclick=()=>importGuest();
    query('#auth-logout',d.shade).onclick=async()=>{
      const ok=await syncNow();
      if(!ok&&!confirm('Есть несинхронизированные отметки. Они останутся в браузере для следующего входа в этот аккаунт. Выйти?'))return;
      const {error}=await client.auth.signOut();if(error){notify(`Ошибка выхода: ${error.message}`);return}
      sessionStorage.removeItem(ACTIVE);location.reload();
    };
  }
  // Persist only changes since the previous known state. A missing key is an explicit "not completed" tombstone.
  function captureChanges(){
    if(!user)return;
    const current=readState(userKey(user.id)),before=lastKnown||safeState({}),pending=readQueue(user.id);
    const keys=new Set([...Object.keys(before.completed),...Object.keys(current.completed)]);
    for(const id of keys){
      const prev=before.completed[id]===true,next=current.completed[id]===true;
      if(prev!==next)pending.topics[id]=next;
    }
    const modules=new Set([...Object.keys(before.reading),...Object.keys(current.reading)]);
    if(current.last)modules.add(String(current.last.module));
    if(before.last)modules.add(String(before.last.module));
    for(const num of modules){
      const percent=current.reading[num]||0;
      const topic=current.last?.module===Number(num)?current.last.topic:(pending.reading[num]?.topic||null);
      const prevTopic=before.last?.module===Number(num)?before.last.topic:null;
      if(percent!==(before.reading[num]||0)||(topic&&topic!==prevTopic)){
        pending.reading[num]={percent,topic:topic||null};
      }
    }
    saveQueue(pending);lastKnown=current;
    if(hasQueue(pending))scheduleSync();
  }
  function scheduleSync(){if(!user)return;clearTimeout(uploadTimer);uploadTimer=setTimeout(()=>{syncNow()},2500)}
  function importGuest(){
    if(!user)return;
    const guest=readState(BASE),current=readState(userKey(user.id)),count=Object.keys(guest.completed).length;
    if(!count){notify('Гостевых отметок пока нет');return}
    if(!confirm(`Добавить ${count} изученных гостевых тем к аккаунту? Гостевые отметки останутся в этом браузере.`))return;
    const merged={...current,completed:{...current.completed,...guest.completed},reading:{...guest.reading,...current.reading},last:current.last||guest.last};
    writeState(userKey(user.id),merged);captureChanges();location.reload();
  }
  async function pullCloud(){
    const [t,r]=await Promise.all([
      client.from('study_topic_progress').select('topic_id,completed').eq('user_id',user.id),
      client.from('study_reading_progress').select('module_num,topic_id,percent,updated_at').eq('user_id',user.id)
    ]);
    if(t.error)throw t.error;if(r.error)throw r.error;
    return {topics:t.data||[],reading:r.data||[]};
  }
  function mergeRemote(remote){
    const old=readState(userKey(user.id)),pending=readQueue(user.id),state=safeState(old);
    state.completed={};state.reading={};state.last=null;
    for(const row of remote.topics){if(allTopics.has(row.topic_id)&&row.completed===true)state.completed[row.topic_id]=true}
    let mostRecent=null;
    for(const row of remote.reading){
      if(!Number.isInteger(row.module_num)||row.module_num<1||row.module_num>12)continue;
      state.reading[row.module_num]=Math.min(100,Math.max(0,Number(row.percent)||0));
      if(row.topic_id&&allTopics.has(`${row.module_num}:${row.topic_id}`)&&(!mostRecent||row.updated_at>mostRecent.updated_at))mostRecent=row;
    }
    if(mostRecent){
      const module=(window.DV_MODULES||[]).find(m=>m.num===mostRecent.module_num);
      const topic=module?.sections.find(s=>s.id===mostRecent.topic_id);
      state.last={module:mostRecent.module_num,topic:mostRecent.topic_id,title:topic?.title||''};
    }
    // Local edits pending from offline sessions always remain in the local view until successfully uploaded.
    for(const [id,completed] of Object.entries(pending.topics)){
      if(completed)state.completed[id]=true;else delete state.completed[id];
    }
    for(const [num,reading] of Object.entries(pending.reading)){
      state.reading[num]=Math.min(100,Math.max(0,Number(reading.percent)||0));
      if(reading.topic&&allTopics.has(`${num}:${reading.topic}`)){
        const module=(window.DV_MODULES||[]).find(m=>m.num===Number(num));
        state.last={module:Number(num),topic:reading.topic,title:module?.sections.find(s=>s.id===reading.topic)?.title||''};
      }
    }
    const changed=JSON.stringify(old)!==JSON.stringify(state);
    if(changed)writeState(userKey(user.id),state);
    lastKnown=state;
    return changed;
  }
  async function flushQueue(){
    const uid=user.id,pending=readQueue(uid);
    if(!hasQueue(pending))return;
    const entries=Object.entries(pending.topics);
    if(entries.length){
      const rows=entries.map(([topic_id,completed])=>({user_id:uid,topic_id,completed}));
      const {error}=await client.from('study_topic_progress').upsert(rows,{onConflict:'user_id,topic_id'});
      if(error)throw error;
      const current=readQueue(uid);
      for(const [id,value] of entries){if(current.topics[id]===value)delete current.topics[id]}
      saveQueue(current);
    }
    const readings=Object.entries(pending.reading);
    if(readings.length){
      const rows=readings.map(([num,item])=>({user_id:uid,module_num:Number(num),topic_id:item.topic||null,percent:item.percent}));
      const {error}=await client.from('study_reading_progress').upsert(rows,{onConflict:'user_id,module_num'});
      if(error)throw error;
      const current=readQueue(uid);
      for(const [num,item] of readings){if(JSON.stringify(current.reading[num])===JSON.stringify(item))delete current.reading[num]}
      saveQueue(current);
    }
  }
  async function syncNow(){
    if(!user||!client)return false;
    if(uploading)return false;
    clearTimeout(uploadTimer);uploading=true;
    try{
      await flushQueue();
      const changed=mergeRemote(await pullCloud());
      if(changed)location.reload();
      return true;
    }catch(error){console.warn('Data Vault progress sync:',error.message);notify('Связь с облаком недоступна. Изменения сохранены локально.');return false}
    finally{uploading=false}
  }
  async function beginSession(account,{offerGuestImport=false}={}){
    if(!account)return;
    const prior=sessionStorage.getItem(ACTIVE);
    user=account;setLabel();
    const previousCache=readState(userKey(user.id));
    lastKnown=previousCache;
    sessionStorage.setItem(ACTIVE,user.id);
    let fetched=false,changed=false;
    try{changed=mergeRemote(await pullCloud());fetched=true}
    catch(error){notify('Нет соединения с облаком. Доступен локальный кеш аккаунта.')}
    if(fetched && offerGuestImport){
      const guest=readState(BASE);
      if(Object.keys(guest.completed).length&&confirm('Перенести изученные темы из гостевого режима в этот аккаунт?')){
        const local=readState(userKey(user.id));
        writeState(userKey(user.id),{...local,completed:{...local.completed,...guest.completed},last:local.last||guest.last,reading:{...guest.reading,...local.reading}});
        captureChanges();changed=true;
      }
    }
    if(prior!==user.id||changed){location.reload()}
    else if(hasQueue(readQueue(user.id)))scheduleSync();
  }
  async function init(){
    if(!enabled)return;
    try{
      if(!/^https:\/\//.test(config.url)||!config.publishableKey.startsWith('sb_publishable_'))throw Error('Некорректная публичная конфигурация');
      const sdk=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/+esm');
      client=sdk.createClient(config.url,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
      const {data,error}=await client.auth.getSession();if(error)throw error;
      if(data.session?.user)await beginSession(data.session.user);
      else if(sessionStorage.getItem(ACTIVE)){sessionStorage.removeItem(ACTIVE);location.reload()}
      client.auth.onAuthStateChange((event,session)=>{
        if(event==='SIGNED_OUT'&&sessionStorage.getItem(ACTIVE)){sessionStorage.removeItem(ACTIVE);location.reload()}
      });
    }catch(error){console.warn('Data Vault auth:',error.message);notify('Регистрация временно недоступна. Гостевой режим работает.')}
  }
  window.addEventListener('dv-open-auth',()=>{
    const dialog=openDialog();
    if(!enabled||!client)showDisabled(dialog);
    else if(user)showAccount(dialog);
    else showGuest(dialog);
  });
  window.addEventListener('dv-progress-changed',captureChanges);
  window.addEventListener('online',()=>{if(user)scheduleSync()});
  window.addEventListener('storage',event=>{
    if(user&&event.key===userKey(user.id)){
      // Another tab has edited this account's local cache. Preserve its changes and resync.
      captureChanges();
    }
  });
  init();
})();
