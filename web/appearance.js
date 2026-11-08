import {THEMES,createThemeController,createThemeDisclosure,createThemeDraft} from './themes.js?v=device-theme-08-disconnect-2';
export function createAppearanceUI(document,{onChange=()=>{},onError=()=>{}}={}) {
 const panel=document.getElementById('theme-settings');
 // Optional for old pages and small test DOMs.
 if(!panel?.querySelectorAll || !document.documentElement)return null;
 const buttons=[...panel.querySelectorAll('[data-theme-choice]')];
 const model=createThemeDraft();
 const disclosure=createThemeDisclosure({panel,button:document.getElementById('theme-toggle'),content:document.getElementById('theme-options')});
 const controller=createThemeController({root:document.documentElement,images:[...document.querySelectorAll('[data-theme-image]')],buttons});
 let requested=null,loading=false,generation=0,busy=false;
 const metadata=value=>{
  const theme=THEMES[value],button=buttons.find(button=>button.dataset.themeChoice===theme.id);
  document.getElementById('theme-name').textContent=theme.name;
  document.getElementById('theme-current-name').textContent=theme.name;
  if(button)document.getElementById('theme-current-palette').style.setProperty('--palette',button.style.getPropertyValue('--palette'));
 };
 async function paint(){
  const value=model.value;
  if(requested===value)return;
  requested=value;
  const token=++generation;
  loading=true;onChange();
  const ok=await controller.select(THEMES[value].id);
  if(token!==generation)return;
  loading=false;
  if(ok)metadata(value);
  else {
   requested=null;
   model.cancel();
   onError('Не удалось загрузить оформление. Попробуйте ещё раз.');
  }
  onChange();
 }
 document.getElementById('theme-toggle').addEventListener('click',()=>disclosure.toggle());
 document.getElementById('settings-panel').addEventListener('close',()=>{
  disclosure.setExpanded(false);model.cancel();void paint();onChange();
 });
 for(const button of buttons)button.addEventListener('click',()=>{
  if(busy||!model.supported)return;
  const value=THEMES.findIndex(theme=>theme.id===button.dataset.themeChoice);
  if(model.choose(value))void paint();
 });
 return {
  get value(){return model.value;},get loading(){return loading;},
  sync(snapshot,{connected,open,force=false,pending=false}){
   model.receive(snapshot,{connected,open,force});
   panel.hidden=!connected||!model.supported;
   busy=pending||!connected;
   for(const button of buttons)button.disabled=busy;
   void paint();
  }
 };
}
