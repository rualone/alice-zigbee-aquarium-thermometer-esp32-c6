/*
 * Общий жизненный цикл окон
 * Прокрутка сбрасывается после showModal, поскольку фокус браузера может сам прокрутить содержимое.
 * Окно остаётся в верхнем слое до окончания анимации закрытия; повторные закрытия объединяются.
 * При уменьшенной анимации закрытие выполняется сразу.
 */
export function openDialog(dialog) {
 dialog.showModal();
 // showModal can scroll to the focused control; reset after it has focused.
 dialog.scrollTop=0;
 dialog.scrollLeft=0;
 for(const content of dialog.querySelectorAll?.('.install-body, [data-dialog-scroll]')||[]){
  content.scrollTop=0;
  content.scrollLeft=0;
 }
}

const closing=new WeakMap();
export function closeDialog(dialog) {
 if(closing.has(dialog))return closing.get(dialog);
 const reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 if(!dialog.open||!dialog.animate||reduced){dialog.close();return Promise.resolve();}
 const animation=dialog.animate([
  {opacity:1,transform:'scale(1)'},
  {opacity:0,transform:'scale(.92)'}
 ],{duration:180,easing:'cubic-bezier(.4,0,1,1)',fill:'forwards'});
 dialog.classList.add('dialog-closing');
 const done=animation.finished.catch(()=>{}).then(()=>{
  dialog.close();
  animation.cancel();
  dialog.classList.remove('dialog-closing');
  closing.delete(dialog);
 });
 closing.set(dialog,done);
 return done;
}
