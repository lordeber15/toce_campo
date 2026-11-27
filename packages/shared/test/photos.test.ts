import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundedDimensions, selectPictureSize, photoUnitCode, photoDownloadName, rearCameraBearing, wrapPhotoText, compassLabel, jpegWithPhotoMetadata } from '../src/photos.ts';

test('12 MP exactos, tamaños grandes y pequeños; nunca ampliar ni recortar', () => {
 assert.deepEqual(boundedDimensions(4000,3000), {width:4000,height:3000});
 assert.deepEqual(boundedDimensions(8000,6000), {width:4000,height:3000});
 assert.deepEqual(boundedDimensions(1600,1200), {width:1600,height:1200});
 for(const [w,h] of [[4032,3024],[12000,9000],[4000,8000],[3000,4000]]) {
  const v=boundedDimensions(w!,h!); assert.ok(v.width*v.height<=12_000_000); assert.ok(Math.abs(v.width/v.height-w!/h!)<0.001);
 }
 assert.throws(()=>boundedDimensions(0,5));
});
test('selección de resolución compatible, no usa megapíxeles ilimitados', () => {
 assert.equal(selectPictureSize(['8000x6000','4000x3000','1920x1080']), '4000x3000');
 assert.equal(selectPictureSize(['4032x3024','1920x1080']), '4032x3024');
 assert.equal(selectPictureSize(['8000x6000','4032x3024']), '4032x3024');
 assert.equal(selectPictureSize([]), undefined);
});
test('identificador universal sin perder sufijos de estaciones reubicadas', () => {
 assert.equal(photoUnitCode('EM-01','PC','EM-01-PC1'),'EM01-PC01');
 assert.equal(photoUnitCode('EM-08 R','PC','EM-08 R-PC02'),'EM08R-PC02');
 assert.equal(photoUnitCode('BL-226','VES','BL-226-VES04'),'BL226-VES04');
 assert.equal(photoUnitCode('EM-01','ROA','provisional-abc'),'provisional-abc');
});
test('nombre descargable diferencia método y unidad; no cuela PC01 en método', () => {
 const x={station:'EM-01',methodCode:'PC',methodName:'Puntos de conteo',unit:'EM-01-PC01',taken:'20261127-064500',id:'12345678-abcd'};
 assert.equal(photoDownloadName({...x,kind:'foto'}),'EM01-PC01_UNIDAD_20261127-064500_12345678.jpg');
 assert.equal(photoDownloadName({...x,kind:'foto_metodo'}),'EM01_Puntos_de_conteo_METODO_20261127-064500_12345678.jpg');
 assert.ok(photoDownloadName({...x,kind:'foto'},true).endsWith('_SIN_ROTULO.jpg'));
});
test('azimut de cámara trasera, giro horizontal del teléfono y cardinales', () => {
 assert.equal(rearCameraBearing({x:0,y:1,z:0},{x:0,y:20,z:-30}),0);
 assert.equal(rearCameraBearing({x:0,y:1,z:0},{x:-30,y:20,z:0}),90);
 assert.equal(rearCameraBearing({x:0,y:1,z:0},{x:0,y:20,z:30}),180);
 assert.equal(rearCameraBearing({x:0,y:1,z:0},{x:30,y:20,z:0}),270);
 assert.equal(rearCameraBearing({x:1,y:0,z:0},{x:20,y:0,z:-30}),0);
 assert.equal(rearCameraBearing({x:-1,y:0,z:0},{x:-20,y:0,z:-30}),0);
 assert.equal(compassLabel(359.9),'N 0°');
});
test('no inventa brújula con cámara vertical, movimiento o campo magnético anómalo', () => {
 assert.equal(rearCameraBearing({x:0,y:0,z:1},{x:0,y:30,z:20}),null);
 assert.equal(rearCameraBearing({x:0,y:2,z:0},{x:0,y:20,z:-30}),null);
 assert.equal(rearCameraBearing({x:0,y:1,z:0},{x:0,y:20,z:-300}),null);
});
test('textos largos conservan toda la UV y coordenadas sin puntos suspensivos', () => {
 const s='EM01-PC01 | UV: Bosque montano de ladera con matorrales y vegetación secundaria';
 const rows=wrapPhotoText(s,24,x=>x.length);
 assert.equal(rows.join(' '),s); assert.ok(rows.every(x=>x.length<=24));
 const word='ABCDEFGHIJKLMN';assert.equal(wrapPhotoText(word,4,x=>x.length).join(''),word);
});

test('metadatos persistentes en JPEG sin modificar los bytes de imagen', () => {
 const input = new Uint8Array([255,216,255,217]);
 const metadata={vegetationUnit:'Bosque húmedo',altitude:2450,altitudeReference:'WGS84_ellipsoid'};
 const result=jpegWithPhotoMetadata(input,metadata);
 const size=result[4]!*256+result[5]!-2;
 assert.deepEqual(JSON.parse(new TextDecoder().decode(result.slice(6,6+size))),metadata);
 assert.deepEqual([...result.slice(6+size)],[255,217]);
 assert.throws(()=>jpegWithPhotoMetadata(new Uint8Array([0,0]),{}));
});
