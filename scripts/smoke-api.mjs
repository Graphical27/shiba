import assert from 'node:assert/strict';
const base=process.env.API_BASE_URL??'http://localhost:3000';
async function json(path,body){const response=await fetch(base+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);return {status:response.status,data:await response.json()};}
assert.equal((await json('/api/health')).data.status,'ok');
for(const city of ['mumbai','delhi','chennai']){const {status,data}=await json(`/api/forecast?city=${city}`);assert.equal(status,200);assert.equal(data.dataset.city,city);assert.equal(data.frames.length,13);assert.ok(data.massBalance.relativeError<1e-9);}
assert.equal((await json('/api/forecast?city=invalid')).status,400);
assert.equal((await json('/api/forecast?rainfallMmHr=NaN')).status,400);
const route=await json('/api/route',{from:'n0',to:'n48',departureMinute:60});
assert.equal(route.status,200);assert.equal(route.data.status,'ok');assert.equal(route.data.geometry.type,'LineString');
assert.ok(route.data.safer.edgeIds.every(id=>!route.data.excludedEdges.includes(id)));
const expired=await json('/api/route',{from:'n0',to:'n48',departureMinute:180});
assert.equal(expired.data.status,'insufficient_data');assert.equal(expired.data.geometry,null);
assert.equal((await json('/api/route',{from:'unknown',to:'n48'})).status,400);
assert.equal((await json('/api/route',{from:[0,0],to:'n48'})).status,422);
assert.equal((await json('/api/simulate',{dataset:{}})).status,400);
const obs=Array.from({length:3},()=>Array(16).fill(5));
const rain=await json('/api/nowcast',{width:4,height:4,observations:obs,observationStepMinutes:15,observedThrough:'2026-09-08T00:00:00Z'});
assert.equal(rain.status,200);assert.equal(rain.data.frames.length,13);
const spec=await json('/api/openapi');assert.equal(spec.data.openapi,'3.1.0');assert.ok(spec.data.paths['/api/live']);
const preflight=await fetch(base+'/api/route',{method:'OPTIONS'});assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),'*');
console.log('API smoke checks passed: all cities, routing, input failures, advection, OpenAPI and CORS.');
