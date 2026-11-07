import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDialog,closeDialog} from '../dialogs.js';
test('each opening resets dialog and nested scroller after native focus',()=>{
 const content={scrollTop:200,scrollLeft:10};
 const dialog={scrollTop:100,scrollLeft:20,showModal(){this.scrollTop=350;},querySelectorAll(){return [content];}};
 for(let i=0;i<2;i++){
  content.scrollTop=200;
  openDialog(dialog);
  assert.equal(dialog.scrollTop,0);assert.equal(dialog.scrollLeft,0);
  assert.equal(content.scrollTop,0);assert.equal(content.scrollLeft,0);
 }
});

test('close keeps dialog open until scaling finishes and coalesces repeated clicks',async()=>{
 let finish,closed=0;
 const animation={finished:new Promise(resolve=>finish=resolve),cancel(){}};
 const dialog={open:true,classList:{add(){},remove(){}},animate(frames){assert.equal(frames[1].transform,'scale(.92)');return animation;},close(){closed++;this.open=false;}};
 const pending=closeDialog(dialog);
 assert.equal(closeDialog(dialog),pending);assert.equal(closed,0);
 finish();await pending;assert.equal(closed,1);
});
