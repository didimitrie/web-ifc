import fs from "fs"
import * as WebIFC from "../../../dist/web-ifc-api-node.js"
const { performance } = require('perf_hooks')
import { IfcElements, Node, getHash, PropsNames, pName, geometryTypes, IfcTypesMap } from "./utils"

// const filePath = "../Modelo_FESHT_IFC_V1.ifc"
// const filePath = "../Modelo_BIM_Fase_1_Cantina_V7.ifc"
// const filePath = "../Week 37 11 sept IFC Schependomlaan incl planningsdata.ifc" // note, 67mb
const filePath = "../Holter_Tower_10.ifc" // note, 130mb!
// const filePath = "../20210219Architecture.ifc" 
// const filePath = "../example-lg.ifc"
// const filePath = "../example-3.ifc"
// const filePath = "../steelplates.ifc" 
// const filePath = "../institute.ifc" 
// const filePath = "../example-2.ifc" // house from finnish people
// const filePath = "../railing.ifc" 
// const filePath = "../example.ifc"
// const filePath = "test"


let ifcapi: WebIFC.IfcAPI
let modelID: number
let types: any
let psetLines: any
let psetRelations: any[] = []
let psetRelations2: any[] = []
let properties = {}

export default async function() {
  console.log('start speckle parsing')
  const ifcData = fs.readFileSync(filePath);
  ifcapi = new WebIFC.IfcAPI()
  ifcapi.SetWasmPath("./")
  await ifcapi.Init()

  modelID = ifcapi.OpenModel(new Uint8Array(ifcData), { USE_FAST_BOOLS: true })
  let p1 = performance.now()
  await getAllTypesOfModel()
  // await getAllProps()
  let p2 = performance.now()
  await createMeshes()
  let p3 = performance.now()
  
  // return

  console.log(`props: ${(p2-p1).toFixed(1)}ms; geometry: ${(p3-p2).toFixed()}ms`)
  
  const structure = await createSpatialStructure()
  let p4 = performance.now() 
  console.log(`structure: ${(p4-p3).toFixed(1)}ms;`)
  
  console.log('done, writing data file...')
  fs.writeFileSync('./data.json', JSON.stringify(structure));
  console.log('done, see output in data.json')
  
  return structure
}

async function getAllProps() {
  psetLines = ifcapi.GetLineIDsWithType(modelID, WebIFC.IFCRELDEFINESBYPROPERTIES)
  const geometryIds = await getAllGeometriesIDs()
  const allLinesIDs = await ifcapi.GetAllLines(modelID);
  const allLinesCount = allLinesIDs.size()
  for(let i = 0; i <allLinesCount; i++) {
    process.stdout.write(`${(i/allLinesCount*100).toFixed(3)}% props \r`)
    const id = allLinesIDs.get(i)
    if(!geometryIds.has(id)) {
      let props = await getItemProperty(id)
      if(props) {
        if(props.type==="IFCRELDEFINESBYPROPERTIES" && props.RelatedObjects) {
          psetRelations.push(props.RelatedObjects)
        }
        properties[id] = props
      }
    }
  }
  
  console.log('writing prop file...')
  fs.writeFileSync('./properties.json', JSON.stringify(properties));
  console.log('done, see output in properties.json')
  return properties
}

async function createSpatialStructure(includeProperties: boolean = true) {
  const chunks = await getSpatialTreeChunks()
  const allLines = await ifcapi.GetLineIDsWithType(modelID, WebIFC.IFCPROJECT);
  const projectID = allLines.get(0);
  const project = newIfcProject(projectID);
  // project['properties'] = simplifyProperties( getItemProperties(projectID) )
  await populateSpatialNode(project, chunks, includeProperties, [], 0);
  return project;
}

async function getSpatialTreeChunks() {
  const treeChunks: any = {};
  await getChunks(treeChunks, PropsNames.aggregates);
  await getChunks(treeChunks, PropsNames.spatial);
  return treeChunks;
}

async function populateSpatialNode(node: Node, treeChunks: any, includeProperties?: boolean, closures, count) {
  count ++
  console.log(`${count} pushed ${node.expressID}\r`)
  closures.push([])
  await getChildren(node, treeChunks, PropsNames.aggregates, includeProperties, closures, count);
  await getChildren(node, treeChunks, PropsNames.spatial, includeProperties, closures, count);
  node["id"] = getHash(node)
  node["closure"] = [...new Set(closures.pop())] // good - why?
  // node["closure"] = closures.pop() // bad - why?
  if(geometryReferences[node.expressID]) {
    node['@displayValue'] = geometryReferences[node.expressID]
    node['closure'].push(...geometryReferences[node.expressID].map(ref => ref.referencedId))
  }
  node["closureLen"] = node["closure"].length
  console.log(`${count} popped\r`)
  return node["id"]
}

 async function getChildren(node: Node, treeChunks: any, propNames: pName, includeProperties?: boolean, closures, count) {
  const children = treeChunks[node.expressID];
  if (children == undefined) return;
  const prop = propNames.key as keyof Node;
  const nodes: any[] = [];
  // There is something dirty here. 
  // getItemProperties is called with the same expressID several times in some cases,
  // and the closure table building is not unique - element ids are repeated several times, needing the set creation above
  // is this perhaps because of "instanced elements"?
  // console.log(`${node.expressID} has ${children.length} children`)
  for(let i = 0; i < children.length; i++){
      const child = children[i];
      let cnode = newNode(child);
      // if (includeProperties) {
          // const properties = await getItemProperties(cnode.expressID) as any;
      //     // cnode.properties = simplifyProperties(properties)
          cnode.properties = properties
      // }
      const id = await populateSpatialNode( cnode, treeChunks, includeProperties, closures, count);
      nodes.push(cnode)
      // console.log(cnode)
      try{
        // for (const closure of closures) closure.push(id, ...cnode['closure']) // push in child node's closure too
        for (let closure of closures){
          closure.push(id) 
          for(let id of cnode['closure']) closure.push(id)
          // closure = closure.concat(cnode['closure'])
        }// push in child node's closure too
      }catch(e) {
        console.log(`Failed to properly append closure for ${node.expressID} ${node.type}`)
        // console.log(e)
      }
  }
  (node[prop] as Node[]) = nodes
}

function simplifyProperties(props) {
  let result = {}
  
  if(Array.isArray(props)){
    for(const prop of props) {
      result[prop.Name.value] = prop.NominalValue.value
    }
    return result
  }

  for(const key in props) {
    if(Array.isArray(props[key])){
      result[key] = props[key].map(item => item.value)
      continue
    } else if(props[key]?.value) {
      result[key] = props[key].value
    } else {
      result[key] = props[key]
    }
  }
  return result
}

 function newNode(id: number) {
  const typeName = getNodeType(id);
  return {
      expressID: id,
      type: typeName,
      children: [],
      properties: null
  };
}

let propCache = {}
async function getItemProperties(id: number) {
  if(propCache[id]) return propCache[id] // essential speedup, at least 20x. this is a smell though - why are we getting the props of the same element so many times?
  
  let props = {}
  let directProps = properties[id.toString()]
  props = {...directProps}

  // gets the damn psets
  let psetIds = [];
  for(let i = 0; i< psetRelations.length; i++) {
    if(psetRelations[i].includes(id)) psetIds.push(psetLines.get(i).toString())
  }

  let rawPsetIds = psetIds.map( id => properties[id].RelatingPropertyDefinition.toString() )
  let rawPsets = rawPsetIds.map(id => properties[id])
  for(let pset of rawPsets) {
    process.stdout.write(`unpacking pset ${pset.expressID}\n`)
    props[pset.Name] = unpackPsetOrComplexProp(pset, 0)
  }
  propCache[id] = props
  return props
}

function unpackPsetOrComplexProp(pset, depth) {
  process.stdout.write(`\nunpacking props ${depth}\r`)
  let parsed = {}
  if(!pset.HasProperties || !Array.isArray(pset.HasProperties)) return parsed
  for(let id of pset.HasProperties) {
    let value = properties[id.toString()]
    if(value?.type === 'IFCCOMPLEXPROPERTY') {
      parsed[value.Name] = unpackPsetOrComplexProp(value, ++depth)
    } else if(value?.type === 'IFCPROPERTYSINGLEVALUE') {
      parsed[value.Name] = value.NominalValue
    }
  }
  depth--
  return parsed
}

function getNodeType(id: number) {
  const typeID = types[id];
  return IfcElements[typeID];
}

async function getChunks(chunks: any, propNames: pName) {
  const relation = await ifcapi.GetLineIDsWithType(modelID, propNames.name);
  for (let i = 0; i < relation.size(); i++) {
    const rel = await ifcapi.GetLine(modelID, relation.get(i), false);
    saveChunk(chunks, propNames, rel);
  }
}

function saveChunk(chunks: any, propNames: pName, rel: any) {
  const relating = rel[propNames.relating].value;
  const related = rel[propNames.related].map((r: any) => r.value);
  if (chunks[relating] == undefined) {
      chunks[relating] = related;
  } else {
      chunks[relating] = chunks[relating].concat(related);
  }
}

function newIfcProject(id: number) {
  return {
      expressID: id,
      type: 'IFCPROJECT',
      children: []
  };
}

async function getAllTypesOfModel() {
  const result = {};
  const elements = Object.keys(IfcElements).map((e) => parseInt(e));
  for(let i = 0; i < elements.length; i++) {
      const element = elements[i];
      const lines = await ifcapi.GetLineIDsWithType(modelID, element);
      const size = lines.size();
      //@ts-ignore
      for (let i = 0; i < size; i++) result[lines.get(i)] = element;
  }
  types = result;
}

async function getItemProperty(id) {
  try {
    const props = await ifcapi.GetLine(modelID, id)
    if(props.type) {
      props.type = IfcTypesMap[props.type]
    }
    formatItemProperties(props)
    return props
  } catch(e) {
    console.log(`There was an issue getting props of id ${id}`)
  }
}

function formatItemProperties(props: any) {
  Object.keys(props).forEach((key) => {
    const value = props[key];
    if (value && value.value !== undefined) props[key] = value.value;
    else if (Array.isArray(value))
      props[key] = value.map((item) => {
        if (item && item.value) return item.value;
        return item;
      });
  });
}

let geometryIdsCount = 0
async function getAllGeometriesIDs() {
  const geometriesIDs = new Set<number>();
  const geomTypesArray = Array.from(geometryTypes);
  for (let i = 0; i < geomTypesArray.length; i++) {
    const category = geomTypesArray[i];
    const ids = await ifcapi.GetLineIDsWithType(modelID, category);
    const idsSize = ids.size();
    for (let j = 0; j < idsSize; j++) {
      geometriesIDs.add(ids.get(j));
    }
  }
  geometryIdsCount = geometriesIDs.size
  return geometriesIDs;
}

let geometryReferences = {}
async function createMeshes() {
  let i = 0
  ifcapi.StreamAllMeshes(modelID, (mesh: WebIFC.FlatMesh) => {
    // process.stdout.write(`${(i++/geometryIdsCount*100).toFixed(3)}% geoms generated \r`)
    process.stdout.write(`${(i++).toFixed(3)} geoms generated \r`)
    const placedGeometries = mesh.geometries
    geometryReferences[mesh.expressID] = []
    for (let i = 0; i < placedGeometries.size(); i++)
    {
        const placedGeometry = placedGeometries.get(i);
        const geometry = ifcapi.GetGeometry(modelID, placedGeometry.geometryExpressID)
        const verts = ifcapi.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize())
        const indices = ifcapi.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize())
        
        const { vertices } = extractVertexData(verts, placedGeometry.flatTransformation)
        const faces = extractFaces(indices)

        const speckleMesh = {
          speckle_type: 'Objects.Geometry.Mesh',
          id: null,
          units: 'm',
          volume: 0,
          area: 0,
          vertices: Array.from(vertices),
          faces: faces,
          renderMaterial: placedGeometry.color ? colorToMaterial(placedGeometry.color) : null
        }

        speckleMesh.id = getHash(speckleMesh)
        // TODO: push to server
        geometryReferences[mesh.expressID].push( { speckle_type: 'reference', referencedId: speckleMesh.id })
    }
  })  
}

function extractFaces(indices) {
  const faces = []
  for (let i = 0; i < indices.length; i++) {
    if (i % 3 === 0) faces.push(0)
    faces.push(indices[i])
  }
  return faces
}

function extractVertexData(vertexData, matrix) {
  const vertices = []
  const normals = []
  let isNormalData = false
  for (let i = 0; i < vertexData.length; i++) {
    isNormalData ? normals.push(vertexData[i]) : vertices.push(vertexData[i])
    if ((i + 1) % 3 === 0) isNormalData = !isNormalData
  }

  // apply the transform
  for (let k = 0; k < vertices.length; k += 3) {
    const x = vertices[k],
      y = vertices[k + 1],
      z = vertices[k + 2]
    vertices[k] = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]
    vertices[k + 1] = (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) * -1
    vertices[k + 2] = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]
  }

  return { vertices, normals }
}

function colorToMaterial(color) {
  const intColor = (color.w << 24) + ((color.x * 255) << 16) + ((color.y * 255) << 8) + color.z * 255

  return {
    diffuse: intColor,
    opacity: color.w,
    metalness: 0,
    roughness: 1,
    speckle_type: 'Objects.Other.RenderMaterial'
  }
}




