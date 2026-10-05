const modules=[
  ['fixedIncome','Ingresos fijos','income'],
  ['variableIncome','Ingresos variables','income'],
  ['fixedExpenses','Gastos fijos','expense'],
  ['variableExpenses','Gastos variables','expense']
];
const months=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const money=new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0});
const LEGACY_STORAGE_KEY='pfStoreV1';
const USER_STORAGE_PREFIX='pfStoreV2:';
let now=new Date(),year=now.getFullYear(),month=now.getMonth(),openModule='variableExpenses';
let store={};
let auth=null,db=null,currentUser=null,cloudReady=false,cloudStatus='local',cloudMessage='Datos guardados solo en este dispositivo';

const key=(y=year,m=month)=>`${y}-${String(m+1).padStart(2,'0')}`;
const blank=()=>({budgetVariable:0,fixedIncome:[],variableIncome:[],fixedExpenses:[],variableExpenses:[]});
const normalize=d=>({
  budgetVariable:Number(d?.budgetVariable||0),
  fixedIncome:Array.isArray(d?.fixedIncome)?d.fixedIncome:[],
  variableIncome:Array.isArray(d?.variableIncome)?d.variableIncome:[],
  fixedExpenses:Array.isArray(d?.fixedExpenses)?d.fixedExpenses:[],
  variableExpenses:Array.isArray(d?.variableExpenses)?d.variableExpenses:[]
});
function normalizeStore(raw){
  const out={};
  Object.entries(raw&&typeof raw==='object'?raw:{}).forEach(([k,v])=>{
    if(/^\d{4}-\d{2}$/.test(k)) out[k]=normalize(v);
  });
  return out;
}
function loadStoreByKey(storageKey){
  try{return normalizeStore(JSON.parse(localStorage.getItem(storageKey)||'{}'));}
  catch{return {};}
}
function userStorageKey(uid){return USER_STORAGE_PREFIX+uid;}
function loadUserStore(uid){return uid?loadStoreByKey(userStorageKey(uid)):{};}
function loadLegacyStore(){return loadStoreByKey(LEGACY_STORAGE_KEY);}
const data=()=>normalize(store[key()]||blank());
function saveLocal(){if(currentUser)localStorage.setItem(userStorageKey(currentUser.uid),JSON.stringify(store));}
function hasData(s=store){
  return Object.values(s||{}).some(d=>{
    const n=normalize(d);
    return n.budgetVariable||n.fixedIncome.length||n.variableIncome.length||n.fixedExpenses.length||n.variableExpenses.length;
  });
}
async function saveCloud(){
  if(!cloudReady||!currentUser||!db)return;
  try{
    cloudStatus='syncing'; cloudMessage='Guardando cambios en la nube…'; updateCloudBadge();
    await db.collection('users').doc(currentUser.uid).collection('app').doc('finanzas').set({
      store,
      updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
      schemaVersion:3
    });
    cloudStatus='synced'; cloudMessage='Sincronizado con Firebase'; updateCloudBadge();
  }catch(err){
    console.error(err);
    cloudStatus='error'; cloudMessage='No se pudo sincronizar. Tus cambios siguen guardados localmente.'; updateCloudBadge();
  }
}
function mutate(fn){
  const k=key();
  store[k]=normalize(fn(normalize(store[k]||blank())));
  saveLocal();
  render();
  saveCloud();
}
const sum=a=>a.reduce((t,x)=>t+Number(x.amount||0),0);
const monthResult=d=>sum(d.fixedIncome)+sum(d.variableIncome)-sum(d.fixedExpenses)-sum(d.variableExpenses);
function totals(){
  const d=data();
  const income=sum(d.fixedIncome)+sum(d.variableIncome);
  const expenses=sum(d.fixedExpenses)+sum(d.variableExpenses);
  const variableSpent=sum(d.variableExpenses);
  return{income,expenses,variableSpent,budgetRemaining:Number(d.budgetVariable||0)-variableSpent,cash:income-expenses};
}
function accumulatedBefore(y,m){
  const target=y*12+m;
  return Object.keys(store).reduce((acc,k)=>{
    const match=/^(\d{4})-(\d{2})$/.exec(k);
    if(!match)return acc;
    const ky=Number(match[1]),km=Number(match[2])-1;
    if(ky*12+km>=target)return acc;
    return acc+monthResult(normalize(store[k]));
  },0);
}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function cloudLabel(){
  if(cloudStatus==='synced')return '☁ Sincronizado';
  if(cloudStatus==='syncing')return '↻ Sincronizando';
  if(cloudStatus==='error')return '⚠ Error de nube';
  if(currentUser)return '☁ Conectado';
  return '◌ Solo local';
}
function render(){
  if(auth && !currentUser){renderAuth();return;}
  const d=data(),t=totals(),previous=accumulatedBefore(year,month),accumulated=previous+t.cash;
  document.querySelector('#app').innerHTML=`<div class='app-shell'>
    <header class='topbar'>
      <div><div class='brand'>◉ Finanzas Personales</div><div class='subtitle'>Control mensual de ingresos y gastos</div></div>
      <div class='top-actions'>
        <button class='cloud-pill ${cloudStatus}' onclick='showCloudPanel()'>${cloudLabel()}</button>
        <div class='month-nav'>
          <button class='icon-btn' onclick='move(-1)' aria-label='Mes anterior'>←</button>
          <div class='month-selects'>
            <select onchange='month=+this.value;render()'>${months.map((m,i)=>`<option value='${i}' ${i===month?'selected':''}>${m}</option>`).join('')}</select>
            <select onchange='year=+this.value;render()'>${Array.from({length:11},(_,i)=>now.getFullYear()-5+i).map(y=>`<option ${y===year?'selected':''}>${y}</option>`).join('')}</select>
          </div>
          <button class='icon-btn' onclick='move(1)' aria-label='Mes siguiente'>→</button>
        </div>
      </div>
    </header>
    <main class='content'>
      <section class='hero-card'>
        <div class='hero-title'>▣ ${months[month]} ${year}</div>
        <div class='hero-balance ${t.cash<0?'negative':'positive'}'>${money.format(t.cash)}</div>
        <div class='hero-caption'>Resultado del mes</div>
      </section>
      <section class='stats-grid'>
        ${stat('Ingresos del mes',t.income)}
        ${stat('Gastos del mes',t.expenses)}
        ${stat('Presupuesto variable restante',t.budgetRemaining,t.budgetRemaining<0)}
        ${stat('Saldo acumulado',accumulated,accumulated<0,'Mes anterior '+money.format(previous)+' + resultado actual')}
      </section>
      <section class='quick-add-card'>
        <div><div class='section-kicker'>Movimientos</div><h2>Registrar input</h2><p>Agrega cualquier ingreso o gasto desde un solo formulario.</p></div>
        <button class='add-main-btn' onclick='showForm()'>＋ Agregar input</button>
      </section>
      <section class='budget-card'>
        <div class='section-kicker'>Gastos variables</div><h2>Presupuesto mensual</h2>
        <p>Define el tope del mes y controla cuánto queda disponible.</p>
        <div class='budget-input-wrap'><span>$</span><input type='text' inputmode='numeric' value='${d.budgetVariable?formatThousands(d.budgetVariable):''}' placeholder='0' oninput='formatBudgetInput(this)' onchange='setBudget(this.value)'></div>
        <div class='progress'><div style='width:${Math.min(100,d.budgetVariable?(t.variableSpent/d.budgetVariable)*100:0)}%'></div></div>
        <div class='budget-row'><span>Ejecutado: <b>${money.format(t.variableSpent)}</b></span><span>Restante: <b class='${t.budgetRemaining<0?'text-danger':''}'>${money.format(t.budgetRemaining)}</b></span></div>
      </section>
      <section class='modules'>${modules.map(m=>moduleCard(m,d[m[0]])).join('')}</section>
    </main>
  </div><div id='modal'></div><input id='importFile' type='file' accept='application/json,.json' hidden onchange='importBackup(event)'>`;
}
function updateCloudBadge(){
  const btn=document.querySelector('.cloud-pill');
  if(!btn)return;
  btn.className=`cloud-pill ${cloudStatus}`;
  btn.textContent=cloudLabel();
}
function stat(title,value,danger=false,caption=''){
  return `<div class='stat-card'><div class='stat-icon'>●</div><div><div class='stat-label'>${title}</div><div class='stat-value ${danger?'text-danger':''}'>${money.format(value)}</div>${caption?`<div class='stat-caption'>${caption}</div>`:''}</div></div>`;
}
function moduleCard(m,items){
  const [k,label]=m,total=sum(items),open=openModule===k;
  return `<div class='module-card'>
    <button class='module-head' onclick="toggle('${k}')">
      <div class='module-title'><span class='module-icon'>$</span><span>${label}</span></div>
      <div class='module-total'><b>${money.format(total)}</b><span>${open?'⌃':'⌄'}</span></div>
    </button>
    ${open?`<div class='module-body'>${items.length?`<div class='items'>${items.map(x=>itemRow(k,x)).join('')}</div>`:`<div class='empty'>Aún no hay movimientos en este mes.</div>`}</div>`:''}
  </div>`;
}
function itemRow(k,x){
  return `<div class='item'>
    <div class='item-main'><div class='item-concept'>${esc(x.concept)}</div><div class='item-meta'>${x.date||'Sin fecha'}</div></div>
    <div class='item-right'><b>${money.format(x.amount)}</b><div class='item-actions'><button class='edit-btn' onclick="showForm('${k}','${x.id}')" aria-label='Editar'>✎</button><button class='trash' onclick="removeItem('${k}','${x.id}')" aria-label='Eliminar'>×</button></div></div>
  </div>`;
}
function move(delta){const d=new Date(year,month+delta,1);year=d.getFullYear();month=d.getMonth();render();}
function toggle(k){openModule=openModule===k?null:k;render();}
function parseThousands(v){return Number(String(v||'').replace(/\D/g,''))||0;}
function formatThousands(v){return parseThousands(v).toLocaleString('es-CO');}
function formatBudgetInput(el){const n=parseThousands(el.value);el.value=n?formatThousands(n):'';}
function setBudget(v){mutate(d=>({...d,budgetVariable:parseThousands(v)}));}
function removeItem(k,id){if(confirm('¿Eliminar este movimiento?'))mutate(d=>({...d,[k]:d[k].filter(x=>x.id!==id)}));}
function showForm(k='',id=''){
  const editing=Boolean(k&&id);
  const d=data();
  const existing=editing?d[k].find(x=>x.id===id):null;
  const selectedCategory=k||'variableExpenses';
  document.querySelector('#modal').innerHTML=`<div class='modal-backdrop' onclick='if(event.target===this)closeForm()'><div class='modal'>
    <div class='modal-head'><div><div class='section-kicker'>${editing?'Editar input':'Nuevo input'}</div><h2>${editing?'Modificar movimiento':'Registrar movimiento'}</h2></div><button class='icon-btn' onclick='closeForm()'>×</button></div>
    <form onsubmit="submitForm(event,'${k}','${id}')">
      <label>Categoría<select id='fCategory' ${editing?'disabled':''}>${modules.map(([mk,label])=>`<option value='${mk}' ${mk===selectedCategory?'selected':''}>${label}</option>`).join('')}</select></label>
      <label>Concepto<input id='fConcept' required autofocus placeholder='Ej. Salario, arriendo, mercado...' value='${esc(existing?.concept||'')}'></label>
      <label>Valor<input id='fAmount' required type='number' inputmode='numeric' placeholder='0' value='${existing?.amount??''}'></label>
      <label>Fecha<input id='fDate' type='date' value='${existing?.date||''}'></label>
      <button class='save-btn'>${editing?'Guardar cambios':'Guardar input'}</button>
    </form>
  </div></div>`;
}
function closeForm(){document.querySelector('#modal').innerHTML='';}
function submitForm(e,k,id){
  e.preventDefault();
  const category=k||document.querySelector('#fCategory').value;
  const item={
    id:id||(crypto.randomUUID?crypto.randomUUID():Date.now().toString()),
    concept:document.querySelector('#fConcept').value.trim(),
    amount:Number(document.querySelector('#fAmount').value),
    date:document.querySelector('#fDate').value
  };
  mutate(d=>{
    if(id)return {...d,[category]:d[category].map(x=>x.id===id?item:x)};
    return {...d,[category]:[...d[category],item]};
  });
  closeForm();
}
function showCloudPanel(){
  const signed=Boolean(currentUser);
  document.querySelector('#modal').innerHTML=`<div class='modal-backdrop' onclick='if(event.target===this)closeForm()'><div class='modal cloud-modal'>
    <div class='modal-head'><div><div class='section-kicker'>Respaldo y sincronización</div><h2>${signed?'Firebase conectado':'Protege y sincroniza tus datos'}</h2></div><button class='icon-btn' onclick='closeForm()'>×</button></div>
    <div class='cloud-summary ${cloudStatus}'><b>${cloudLabel()}</b><span>${esc(cloudMessage)}</span>${signed?`<small>${esc(currentUser.email||'Cuenta de usuario')}</small>`:''}</div>
    ${signed?`<button class='save-btn secondary' onclick='forceCloudUpload()'>↑ Guardar copia actual en la nube</button><button class='outline-btn' onclick='signOutCloud()'>Cerrar sesión</button>`:`<button class='save-btn' onclick='renderAuth()'>Iniciar sesión</button>`}
    <div class='divider'><span>Copia de seguridad</span></div>
    <p class='help-text'>Exporta un archivo JSON para conservar una copia o trasladar los datos de la versión local a la versión en línea.</p>
    <div class='backup-actions'><button class='outline-btn' onclick='exportBackup()'>↓ Exportar respaldo</button><button class='outline-btn' onclick="document.querySelector('#importFile').click();closeForm()">↑ Importar respaldo</button></div>
  </div></div>`;
}
async function forceCloudUpload(){await saveCloud();showCloudPanel();}
function exportBackup(){
  const payload={app:'Finanzas Personales Yontaran',version:2,exportedAt:new Date().toISOString(),store};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`finanzas-yontaran-respaldo-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(a.href);
}
async function importBackup(event){
  const file=event.target.files?.[0];
  event.target.value='';
  if(!file)return;
  try{
    const parsed=JSON.parse(await file.text());
    const incoming=normalizeStore(parsed?.store||parsed);
    if(!hasData(incoming)&&Object.keys(incoming).length===0)throw new Error('El archivo no contiene datos reconocibles.');
    if(hasData(store)&&!confirm('Esto reemplazará los datos actuales por los del respaldo. ¿Continuar?'))return;
    store=incoming;saveLocal();render();
    if(cloudReady&&currentUser)await saveCloud();
    alert('Respaldo importado correctamente.');
  }catch(err){alert('No se pudo importar el respaldo: '+err.message);}
}
function renderAuth(mode='login',message=''){
  const isRegister=mode==='register';
  document.querySelector('#app').innerHTML=`<div class='auth-shell'>
    <div class='auth-card'>
      <div class='auth-brand'>◉ Finanzas Yontaran</div>
      <h1>${isRegister?'Crear cuenta':'Iniciar sesión'}</h1>
      <p class='auth-intro'>${isRegister?'Crea tu cuenta personal. Tus datos financieros quedarán separados de los demás usuarios.':'Accede a tus finanzas desde cualquier dispositivo.'}</p>
      ${message?`<div class='auth-message'>${esc(message)}</div>`:''}
      <form onsubmit="${isRegister?'registerUser(event)':'loginUser(event)'}">
        ${isRegister?`<label>Nombre<input id='authName' required autocomplete='name' placeholder='Tu nombre'></label>`:''}
        <label>Correo electrónico<input id='authEmail' type='email' required autocomplete='email' placeholder='correo@ejemplo.com'></label>
        <label>Contraseña<input id='authPassword' type='password' required minlength='8' autocomplete='${isRegister?'new-password':'current-password'}' placeholder='Mínimo 8 caracteres'></label>
        ${isRegister?`<label>Confirmar contraseña<input id='authPassword2' type='password' required minlength='8' autocomplete='new-password' placeholder='Repite la contraseña'></label>`:''}
        <button class='save-btn'>${isRegister?'Crear cuenta':'Entrar'}</button>
      </form>
      ${!isRegister?`<button class='link-btn' onclick='resetPassword()'>Olvidé mi contraseña</button>`:''}
      <div class='auth-switch'>${isRegister?'¿Ya tienes cuenta?':'¿No tienes cuenta?'} <button onclick="renderAuth('${isRegister?'login':'register'}')">${isRegister?'Iniciar sesión':'Registrarme'}</button></div>
      <div class='auth-note'>Cada usuario tiene un identificador independiente en Firebase y solo puede acceder a sus propios datos.</div>
    </div>
  </div>`;
}
function friendlyAuthError(err){
  const map={
    'auth/email-already-in-use':'Ese correo ya está registrado.',
    'auth/invalid-email':'El correo electrónico no es válido.',
    'auth/weak-password':'La contraseña es demasiado débil.',
    'auth/invalid-credential':'Correo o contraseña incorrectos.',
    'auth/user-not-found':'Correo o contraseña incorrectos.',
    'auth/wrong-password':'Correo o contraseña incorrectos.',
    'auth/too-many-requests':'Demasiados intentos. Intenta nuevamente más tarde.',
    'auth/network-request-failed':'No hay conexión con Firebase. Revisa tu Internet.'
  };
  return map[err?.code]||err?.message||'No se pudo completar la operación.';
}
async function registerUser(e){
  e.preventDefault();
  if(!auth)return;
  const name=document.querySelector('#authName').value.trim();
  const email=document.querySelector('#authEmail').value.trim();
  const p1=document.querySelector('#authPassword').value;
  const p2=document.querySelector('#authPassword2').value;
  if(p1!==p2){renderAuth('register','Las contraseñas no coinciden.');return;}
  try{
    const cred=await auth.createUserWithEmailAndPassword(email,p1);
    if(name)await cred.user.updateProfile({displayName:name});
    try{await cred.user.sendEmailVerification();}catch(_){}
  }catch(err){console.error(err);renderAuth('register',friendlyAuthError(err));}
}
async function loginUser(e){
  e.preventDefault();
  if(!auth)return;
  const email=document.querySelector('#authEmail').value.trim();
  const password=document.querySelector('#authPassword').value;
  try{await auth.signInWithEmailAndPassword(email,password);}
  catch(err){console.error(err);renderAuth('login',friendlyAuthError(err));}
}
async function resetPassword(){
  if(!auth)return;
  const email=(document.querySelector('#authEmail')?.value||prompt('Escribe el correo de tu cuenta:')||'').trim();
  if(!email)return;
  try{await auth.sendPasswordResetEmail(email);renderAuth('login','Te enviamos un correo para restablecer la contraseña.');}
  catch(err){renderAuth('login',friendlyAuthError(err));}
}
async function signOutCloud(){if(auth)await auth.signOut();store={};closeForm();renderAuth('login');}

async function initFirebase(){
  try{
    if(typeof firebase==='undefined'||!firebase.apps?.length)return;
    auth=firebase.auth();
    db=firebase.firestore();
    try{await db.enablePersistence({synchronizeTabs:true});}catch(e){console.info('Persistencia Firestore no disponible en este contexto.',e.code||e.message);}
    auth.onAuthStateChanged(async user=>{
      currentUser=user||null;
      cloudReady=false;
      if(!user){
        store={};cloudStatus='local';cloudMessage='Inicia sesión para acceder a tus datos';renderAuth('login');return;
      }
      store=loadUserStore(user.uid);
      cloudStatus='syncing';cloudMessage='Cargando datos de Firebase…';render();
      try{
        const ref=db.collection('users').doc(user.uid).collection('app').doc('finanzas');
        const snap=await ref.get();
        if(snap.exists&&snap.data()?.store){
          store=normalizeStore(snap.data().store);saveLocal();
          cloudMessage='Datos cargados y sincronizados con Firebase';
        }else if(hasData(store)){
          await ref.set({store,updatedAt:firebase.firestore.FieldValue.serverTimestamp(),schemaVersion:3});
          cloudMessage='Tus datos locales de esta cuenta se guardaron en Firebase';
        }else{
          const legacy=loadLegacyStore();
          if(hasData(legacy) && confirm('Se encontraron datos de una versión anterior en este navegador. ¿Quieres migrarlos a esta cuenta?')){
            store=legacy;
            saveLocal();
            await ref.set({store,updatedAt:firebase.firestore.FieldValue.serverTimestamp(),schemaVersion:3,migratedFrom:'pfStoreV1'});
            cloudMessage='Datos anteriores migrados y sincronizados con Firebase';
          }else{
            store={};saveLocal();
            await ref.set({store:{},updatedAt:firebase.firestore.FieldValue.serverTimestamp(),schemaVersion:3});
            cloudMessage='Cuenta lista. Aún no hay movimientos guardados.';
          }
        }
        cloudReady=true;cloudStatus='synced';render();
      }catch(err){
        console.error(err);cloudStatus='error';cloudMessage='No se pudo acceder a Firestore. Revisa la conexión y las reglas de seguridad.';render();
      }
    });
  }catch(err){console.error('Firebase init',err);}
}

render();
window.addEventListener('load',initFirebase);
