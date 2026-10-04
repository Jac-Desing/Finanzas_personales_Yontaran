const modules=[
  ['fixedIncome','Ingresos fijos','income'],
  ['variableIncome','Ingresos variables','income'],
  ['fixedExpenses','Gastos fijos','expense'],
  ['variableExpenses','Gastos variables','expense']
];
const months=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const money=new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0});
let now=new Date(),year=now.getFullYear(),month=now.getMonth(),openModule='variableExpenses',store=JSON.parse(localStorage.getItem('pfStoreV1')||'{}');
const key=(y=year,m=month)=>`${y}-${String(m+1).padStart(2,'0')}`;
const blank=()=>({budgetVariable:0,fixedIncome:[],variableIncome:[],fixedExpenses:[],variableExpenses:[]});
const normalize=d=>({
  budgetVariable:Number(d?.budgetVariable||0),
  fixedIncome:Array.isArray(d?.fixedIncome)?d.fixedIncome:[],
  variableIncome:Array.isArray(d?.variableIncome)?d.variableIncome:[],
  fixedExpenses:Array.isArray(d?.fixedExpenses)?d.fixedExpenses:[],
  variableExpenses:Array.isArray(d?.variableExpenses)?d.variableExpenses:[]
});
const data=()=>normalize(store[key()]||blank());
const save=()=>localStorage.setItem('pfStoreV1',JSON.stringify(store));
const mutate=(fn)=>{const k=key();store[k]=normalize(fn(normalize(store[k]||blank())));save();render();};
const sum=a=>a.reduce((t,x)=>t+Number(x.amount||0),0);
const monthResult=d=>sum(d.fixedIncome)+sum(d.variableIncome)-sum(d.fixedExpenses)-sum(d.variableExpenses);
function totals(){
  const d=data();
  const income=sum(d.fixedIncome)+sum(d.variableIncome);
  const expenses=sum(d.fixedExpenses)+sum(d.variableExpenses);
  const variableSpent=sum(d.variableExpenses);
  return{
    income,expenses,variableSpent,
    budgetRemaining:Number(d.budgetVariable||0)-variableSpent,
    cash:income-expenses
  };
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
function render(){
  const d=data(),t=totals(),previous=accumulatedBefore(year,month),accumulated=previous+t.cash;
  document.querySelector('#app').innerHTML=`<div class='app-shell'>
    <header class='topbar'>
      <div><div class='brand'>◉ Finanzas Personales</div><div class='subtitle'>Control mensual de ingresos y gastos</div></div>
      <div class='month-nav'>
        <button class='icon-btn' onclick='move(-1)' aria-label='Mes anterior'>←</button>
        <div class='month-selects'>
          <select onchange='month=+this.value;render()'>${months.map((m,i)=>`<option value='${i}' ${i===month?'selected':''}>${m}</option>`).join('')}</select>
          <select onchange='year=+this.value;render()'>${Array.from({length:11},(_,i)=>now.getFullYear()-5+i).map(y=>`<option ${y===year?'selected':''}>${y}</option>`).join('')}</select>
        </div>
        <button class='icon-btn' onclick='move(1)' aria-label='Mes siguiente'>→</button>
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
  </div><div id='modal'></div>`;
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
function removeItem(k,id){mutate(d=>({...d,[k]:d[k].filter(x=>x.id!==id)}));}
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
render();
