/*
 * Модель оформления и загрузка изображений
 * Идентификаторы тем стабильны и совпадают с числами в прошивке. Порядок менять нельзя без миграции.
 * Цвета применяются вместе с готовым изображением. Ошибка загрузки не должна оставлять смешанную тему.
 * Проверки ранних версий сохранены намеренно: разработчик может установить старую сборку.
 */
// Stable IDs map directly to the firmware theme integer (0..3).
export const THEMES=Object.freeze([
 Object.freeze({id:'planted',name:'Травник'}),
 Object.freeze({id:'marine',name:'Морской'}),
 Object.freeze({id:'biotope',name:'Биотоп'}),
 Object.freeze({id:'reef',name:'Риф'})
]);
export function createThemeController({root,images,buttons=[],onError=()=>{}}) {
 const allowed=new Set(THEMES.map(theme=>theme.id));
 let revision=0,current='planted';
 return {
  get current(){return current;},
  async select(id){
   if(!allowed.has(id))return false;
   const matching=images.filter(image=>image.dataset.themeImage===id);
   if(!matching.length)return false;
   const request=++revision;
   try{
    for(const image of matching)if(!image.getAttribute('src'))image.setAttribute('src',image.dataset.themeSrc);
    // Keep the previous image and colours until the replacement is ready.
    await Promise.all(matching.map(image=>image.decode()));
   }catch(error){if(request===revision)onError(error);return false;}
   if(request!==revision)return false;
   root.dataset.theme=id;
   for(const item of images)item.classList.toggle('is-active',item.dataset.themeImage===id);
   for(const button of buttons)button.setAttribute('aria-pressed',String(button.dataset.themeChoice===id));
   current=id;
   return true;
  }
 };
}
export function supportsDeviceTheme(snapshot) {
 const version=/^(\d+)\.(\d+)(?:\.\d+)?$/.exec(snapshot?.firmware||'');
 return !!version && (Number(version[1])>=1 || Number(version[2])>=8) &&
  snapshot.theme_settings===true && Number.isInteger(snapshot.settings?.theme) &&
  snapshot.settings.theme>=0 && snapshot.settings.theme<THEMES.length;
}
/* Подтверждённая тема и черновик разделены. Опрос устройства не затирает открытый изменённый черновик; явное подтверждение/сброс может принудительно синхронизировать его. Отключение сбрасывает только браузерную модель. */
export function createThemeDraft(){
 let saved=0,value=0,supported=false;
 return {
  get value(){return value;},get supported(){return supported;},
  receive(snapshot,{connected,open=false,force=false}){
   if(!connected){saved=0;value=0;supported=false;return;} // Device preferences remain in NVS.
   const wasSupported=supported;
   supported=supportsDeviceTheme(snapshot);
   const dirty=value!==saved;
   saved=supported?snapshot.settings.theme:0;
   if(!supported||!wasSupported||force||!open||!dirty)value=saved;
  },
  choose(next){if(!supported||!Number.isInteger(next)||next<0||next>=THEMES.length)return false;value=next;return true;},
  cancel(){value=saved;}
 };
}

export function createThemeDisclosure({panel,button,content}) {
 let expanded=false;
 const setExpanded=value=>{
  expanded=!!value;
  button.setAttribute('aria-expanded',String(expanded));
  content.inert=!expanded;
  panel.classList.toggle('is-expanded',expanded);
 };
 setExpanded(false);
 return {setExpanded,toggle(){setExpanded(!expanded);}};
}
