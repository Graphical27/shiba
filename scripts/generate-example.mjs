import { writeFileSync,mkdirSync } from 'node:fs';
import { makeDataset,makeRainCube } from '../lib/flood/fixtures.ts';
const scenario={city:'mumbai',rainfallMmHr:80,blockage:.3,tailwaterM:0};
const dataset=makeDataset('mumbai'),rainfall=makeRainCube(dataset,scenario);
rainfall.issuedAt='2026-09-08T00:00:00Z';rainfall.observedThrough=rainfall.issuedAt;
mkdirSync('examples',{recursive:true});
writeFileSync('examples/mumbai-simulation.json',JSON.stringify({scenario,dataset,rainfall}));
console.log('Created examples/mumbai-simulation.json');
