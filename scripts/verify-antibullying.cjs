const assert=require('node:assert/strict'),fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8'),start=html.indexOf('const PALABRAS_ANTIBULLY='),end=html.indexOf('function randomName()',start);
assert(start>=0&&end>start,'No se encontró el filtro antibullying');
const {filtrarGarabatos,PALABRAS_ANTIBULLY}=new Function(`return (()=>{${html.slice(start,end)};return {filtrarGarabatos,PALABRAS_ANTIBULLY};})()`)();
for(const insulto of ['weón','aweonao','ctm','conchetumare','culiao','idiota','imbécil','mátate','te voy a matar','te odio'])assert(PALABRAS_ANTIBULLY.includes(filtrarGarabatos(insulto)),`No se filtró: ${insulto}`);
assert.equal(filtrarGarabatos('hola @pudu, ¿cómo estás?'),'hola @pudu, ¿cómo estás?');
console.log('Antibullying: OK');
