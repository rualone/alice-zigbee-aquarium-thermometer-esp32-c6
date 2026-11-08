/** Версии продукта сравниваются численно. Неизвестный формат не даёт права на обновление. */
export function compareVersions(left,right){
 const parse=value=>/^\d+\.\d+(?:\.\d+)?$/.test(value||'')?value.split('.').map(Number):null;
 const a=parse(left),b=parse(right);
 if(!a||!b)return null;
 for(let i=0;i<3;i++)if((a[i]||0)!==(b[i]||0))return (a[i]||0)>(b[i]||0)?1:-1;
 return 0;
}
