
// console.log("Starting usage examples...");
const { performance } = require('perf_hooks')

import properties from "./src/properties";
import modification from "./src/modification";
import exporting from "./src/exporting";
import geometrystream from "./src/geometrystream";
import coordination from "./src/coordination";
import speckle from "./src/speckle";
import props from "./src/props";
import meshes from "./src/meshes";

(async() => {
    let p = performance.now()
    await speckle()
    // await meshes();
    let p1 = performance.now()
    console.log(`speckle ${p1-p}`)
    // await props()
    // let p2 = performance.now()
    // console.log(`props ${p2-p1}`)
    // await coordination();
    // await exporting();
    // await properties();
    // await modification();
    // await geometrystream();
})();