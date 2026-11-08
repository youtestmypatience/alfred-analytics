(()=>{'use strict';
const config=window.DV_SUPABASE_CONFIG||{}, enabled=Boolean(config.url&&config.publishableKey), root=document.body;
const ACTIVE='alfred-dv-active-user', BASE='alfred-dv-v1';
let sb=null, user=null, syncing=false, flushTimer=null, cloudRecord=null, latestWrite=0;
const topicIds=new Set((window.DV_MODULES||[]).flatMap(m=>m.sections.map(s=>`${m.num}:${s.id}`)));
const q=(s,base=document)=>base.querySelector(s);
const message=(s)=>{const p=document.createElement('div');p.className='toast';p.textContent=s;root.append(p);setTimeout(()=>p.remove(),4600)};
function safeState(source){const x=source&&typeof source==='object'?source:{};
 return {completed:Object.fromEntries(Object.entries(x.completed||{}).filter(([k,v])=>topicIds.has(k)&&v===true)),
 reading:x.reading&&typeof x.reading==='object'?x.reading:{},
 last:x.last&&typeof x.last==='object'?x.last:null,theme:x.theme==='light'?'light':'dark'};}
function cacheKey(uid){return `${BASE}:user:${uid}`;}
function readStored(k){try{return safeState(JSON.parse(localStorage.getItem(k)||'{}'))}catch{return safeState({})}}
function writeStored(k,x){localStorage.setItem(k,JSON.stringify(safeState(x)))}
function accountLabel(){const el=q('#auth');if(el)el.textContent=user?'☁ Аккаунт':'Войти';}
function popup(){const d=document.createElement('div');d.className='auth-shade';d.setAttribute('role','presentation');
 d.innerHTML=`<section class="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-heading"><div class="auth-row"><h2 id="auth-heading">Мой прогресс</h2><button class="auth-x" type="button" aria-label="Закрыть">×</button></div><div id="auth-contents"></div></section>`;
 root.append(d);root.classList.add('auth-open');const closer=()=>{d.remove();root.classList.remove('auth-open')};
 q('.auth-x',d).onclick=closer;d.onclick=e=>{if(e.target===d)closer()};d.onkeydown=e=>{if(e.key==='Escape')closer()};return {d,closer,place:html=>q('#auth-contents',d).innerHTML=html};}
function renderDisabled(ui){ui.place(`<p>Все учебные модули доступны без аккаунта. Ваши отметки сохраняются в этом браузере.</p><div class="auth-note">Облачная регистрация пока не подключена администратором сайта. Гостевой режим работает полностью независимо.</div>`)}
function loggedOut(ui){ui.place(`<p>Создайте аккаунт для синхронизации отметок между устройствами или продолжайте обучение без регистрации.</p><div class="auth-tabs"><button type="button" class="btn" id="auth-signin">Войти</button><button type="button" class="btn" id="auth-signup">Регистрация</button></div><form id="auth-form"><label>Email<input id="auth-email" type="email" autocomplete="email" required maxlength="240"></label><label>Пароль<input id="auth-password" type="password" autocomplete="current-password" required minlength="6" maxlength="128"></label><button class="primary" id="auth-submit" type="submit">Войти</button><div id="auth-status" aria-live="polite"></div></form><div class="auth-note">Для регистрации подтверждение email может быть обязательным. Доступ без регистрации не ограничен.</div>`);
 let type='signin';const update=()=>{q('#auth-submit',ui.d).textContent=type==='signup'?'Зарегистрироваться':'Войти';q('#auth-password',ui.d).autocomplete=type==='signup'?'new-password':'current-password'};
 q('#auth-signin',ui.d).onclick=()=>{type='signin';update()};q('#auth-signup',ui.d).onclick=()=>{type='signup';update()};
 q('#auth-form',ui.d).onsubmit=async e=>{e.preventDefault();let submit=q('#auth-submit',ui.d),st=q('#auth-status',ui.d);submit.disabled=true;st.className='auth-spinner';st.textContent='Проверка данных…';
 try {const email=q('#auth-email',ui.d).value.trim(), password=q('#auth-password',ui.d).value;
 const result=type==='signup'?await sb.auth.signUp({email,password,options:{emailRedirectTo:location.href.split('#')[0]}}):await sb.auth.signInWithPassword({email,password});
 if(result.error)throw result.error;
 if(!result.data.session){st.className='auth-success';st.textContent='Проверьте email и подтвердите регистрацию, затем войдите.';return;}
 ui.closer();await beginSession(result.data.session.user,{askImport:true});
 }catch(e){st.className='auth-error';st.textContent=e.message||'Не удалось войти'}finally{submit.disabled=false;}
 };
}
function loggedIn(ui){ui.place(`<p>Выполнен вход: <strong id="auth-who"></strong></p><div class="auth-note">Прогресс хранится в защищённой учётной записи Supabase и локальном кеше этого браузера.</div><div style="display:grid;gap:10px;margin-top:18px"><button class="btn" id="auth-sync" type="button">Синхронизировать сейчас</button><button class="btn" id="auth-import-guest" type="button">Добавить отметки гостевого режима</button><button class="btn" id="auth-logout" type="button">Выйти и перейти в гостевой режим</button></div><p class="dim" id="auth-status" aria-live="polite"></p>`);
 q('#auth-who',ui.d).textContent=user.email||'Пользователь';q('#auth-sync',ui.d).onclick=async()=>{const st=q('#auth-status',ui.d);st.textContent='Синхронизация…';await syncNow();st.textContent='Запрос синхронизации завершён'};
 q('#auth-import-guest',ui.d).onclick=()=>importGuest(true);
 q('#auth-logout',ui.d).onclick=async()=>{try{await syncNow();const {error}=await sb.auth.signOut();if(error)throw error;sessionStorage.removeItem(ACTIVE);location.reload()}catch(e){message('Выход не выполнен: '+e.message)}};
}
function importGuest(confirmFirst){if(!user)return;let guest=readStored(BASE),cloud=readStored(cacheKey(user.id));let count=Object.keys(guest.completed).length;if(!count){message('В гостевом режиме нет отмеченных тем');return}
 if(confirmFirst&&!confirm(`Добавить ${count} изученных гостевых тем к вашему аккаунту? Гостевые отметки останутся в браузере.`))return;
 cloud.completed={...guest.completed,...cloud.completed};
 if(!cloud.last)cloud.last=guest.last;
 writeStored(cacheKey(user.id),cloud);scheduleUpload();location.reload();}
async function fetchRemote(){const {data,error}=await sb.from('study_progress').select('payload,updated_at').eq('user_id',user.id).maybeSingle();if(error)throw error;return data;}
async function uploadNow(){if(!user||!sb||syncing)return;syncing=true;const uid=user.id;try{const state=readStored(cacheKey(uid)),value={user_id:uid,payload:state,updated_at:new Date().toISOString()};const {error}=await sb.from('study_progress').upsert(value,{onConflict:'user_id'});if(error)throw error;latestWrite=Date.now();}catch(e){message('Облако недоступно. Изменения остались в этом браузере.');}finally{syncing=false;}}
function scheduleUpload(){if(!user)return;clearTimeout(flushTimer);flushTimer=setTimeout(uploadNow,2000);}
async function syncNow(){if(!user)return;clearTimeout(flushTimer);await uploadNow();}
async function beginSession(u,{askImport=false}={}){if(!u)return;user=u;accountLabel();const previous=sessionStorage.getItem(ACTIVE);sessionStorage.setItem(ACTIVE,u.id);
 let remote=null;try{remote=await fetchRemote()}catch(e){message('Облако недоступно: пока сохранение только в локальном кеше аккаунта')}
 const local=readStored(cacheKey(u.id));
 // When a cloud record exists, it is authoritative at login except for an account cache with pending offline changes.
 // Offline edits remain in local storage and can be imported through the JSON backup.
 if(remote?.payload){const cloud=safeState(remote.payload);cloud.theme=local.theme;writeStored(cacheKey(u.id),cloud)}
 else if(!remote){const guest=readStored(BASE);if(Object.keys(guest.completed).length&&askImport&&confirm('Сохранить отметки гостевого режима в новом аккаунте?')){
 local.completed={...guest.completed,...local.completed};local.last=local.last||guest.last;writeStored(cacheKey(u.id),local);scheduleUpload();}}
 if(previous!==u.id)location.reload();
}
async function init(){if(!enabled)return;
 try{const lib=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');sb=lib.createClient(config.url,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 let {data,error}=await sb.auth.getSession();if(error)throw error;
 if(data.session?.user)await beginSession(data.session.user);
 else if(sessionStorage.getItem(ACTIVE)){sessionStorage.removeItem(ACTIVE);location.reload()}
 }catch(e){message('Облачная авторизация недоступна. Гостевой режим работает.')}}
window.addEventListener('dv-open-auth',()=>{const ui=popup();if(!enabled||!sb)renderDisabled(ui);else if(user)loggedIn(ui);else loggedOut(ui)});
window.addEventListener('dv-progress-changed',scheduleUpload);
window.addEventListener('online',()=>{if(user)scheduleUpload()});
// Keep the browser's guest progress completely separate from the authenticated account state.
init();
})();
