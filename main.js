import "./style.css"
import { Vector3, Vector2, CatmullRomCurve3, TubeGeometry, EdgesGeometry, LineBasicMaterial, LineSegments, WebGLRenderer, Scene, PerspectiveCamera, FogExp2, ACESFilmicToneMapping, SRGBColorSpace } from "three"
import { RenderPass, UnrealBloomPass, EffectComposer } from "three/examples/jsm/Addons.js";

const AudioContext = window.AudioContext || window.webkitAudioContext


const TUBE_SEGMENTS = 222;
const TUBE_RADIUS = 0.65;
const RADIAL_SEGMENTS = 16;
const LOOP_TIME = 10_000;
const HUE_ROTATE_AMOUNT = 1;
const FFT_SIZE = 2048;

async function getMicrophone(){
  try {
    const microphone = await navigator.mediaDevices.getUserMedia({
      audio: true, video: false
    });
    return microphone
  } catch (error) {
    console.warn("Failed to get microphone stream. Application will not start as expected...")
    console.error(error)
    return null
  }
}



function getCircleTube(path_radius=100,path_segments=500, tube_radius=TUBE_RADIUS, tube_segments=TUBE_SEGMENTS){
  const points = [];
  for(let i = 0; i < path_segments; i++){
    const theta = (i/path_segments) * Math.PI/2;
    points.push(new Vector3(path_radius*Math.cos(theta), path_radius*Math.sin(theta),0));
  }
  points.push(points[0])

  const curve = new CatmullRomCurve3(points,true);
  curve.closed = true
  const tubeGeometry = new TubeGeometry(curve,tube_segments,tube_radius,RADIAL_SEGMENTS,false)
  const edges = new EdgesGeometry(tubeGeometry,0.2)
  const tubeMaterial = new LineBasicMaterial({
    color: 0xff00ff
  })
  const tubeLines = new LineSegments(edges,tubeMaterial);
  return {  
    visual: tubeLines, 
    geometry: tubeGeometry
  }
}

function getVisualEnvironment(fogDensity=0.3){
    //create renderer and attach to document
    const renderer = new WebGLRenderer()
    renderer.toneMapping = ACESFilmicToneMapping
    renderer.outputColorSpace = SRGBColorSpace
    document.body.appendChild(renderer.domElement)
    
    const scene = new Scene()
    //apply fog if params specified
    if(fogDensity > 0){
      scene.fog = new FogExp2(0x000000,0.3);
    }


    const camera = new PerspectiveCamera(105,window.innerWidth/window.innerHeight,0.1,1000);

    //handle window resize events
    const setSize = ()=>{
        renderer.setSize(window.innerWidth,window.innerHeight)
        camera.aspect = window.innerWidth/window.innerHeight
        camera.updateProjectionMatrix()
    }
    
    setSize()
    window.addEventListener("resize",setSize);



    //POST-PROCESSING
    const renderPass = new RenderPass(scene,camera);

    //bloom
    const bloomReso = new Vector2(window.innerWidth,window.innerHeight)
    const bloomPass = new UnrealBloomPass(bloomReso, 1.5,0.4,100)
    bloomPass.threshold = 0.002;
    bloomPass.radius = 0


    
    //compose post effects
    const composer =  new EffectComposer(renderer)
    composer.addPass(renderPass)
    composer.addPass(bloomPass)

    return { renderer, scene , camera, composer, bloomPass}
}


class AudioEnvironment {
  /**
   * @type {null|AudioEnvironment}
   */
  static shared = null; 
  static async use(){
    if(AudioEnvironment.shared === null){
      const stream = await getMicrophone();
      if(!stream) return null;
      const context = new AudioContext();
      const streamSrc = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser()
      analyser.fftSize = FFT_SIZE
      streamSrc.connect(analyser);
      AudioEnvironment.shared = new AudioEnvironment(context,analyser,streamSrc);

    }
    return AudioEnvironment.shared
  }

  /**
   * 
   * @param {AudioContext} ctx 
   * @param {AnalyserNode} analyser 
   * @param {MediaStreamAudioSourceNode} streamSrc 
   */
  constructor(ctx,analyser,streamSrc){
    if(AudioEnvironment.shared !== null) 
      throw new Error("AudioEnvironment is a Singleton. It can only be created once!");
    this.ctx = ctx
    this.analyser = analyser
    this.streamSrc = streamSrc
    this.byteFrequencyData = new Uint8Array(analyser.frequencyBinCount);
    this.timeDomainData = new Uint8Array(analyser.fftSize);
  }

  getAverageLoudness(){
    let sum = 0, activeCount = 1;
    for(let i = 0; i < this.analyser.frequencyBinCount; i++){
      if(this.byteFrequencyData[i]){
        sum += this.byteFrequencyData[i]
        activeCount++
      }
    }

    if(activeCount > 1) activeCount--;
    const average = sum / this.analyser.frequencyBinCount;
    const activeAverage = sum/activeCount;
    const adjustedAverage = (average+activeAverage/2)
    return {
      average,activeAverage,adjustedAverage
    }
  }
} 







async function initializeVisualizer(){
  const audioEnv = await AudioEnvironment.use()
  if(!audioEnv) {
    return console.error("failed to get audio environment... cannot start visualizer");
  }
  const worldEnv = getVisualEnvironment(0);
  
  console.time("Generate Tube")
  const tube = getCircleTube(100,500);
  worldEnv.scene.add(tube.visual);
  console.timeEnd("Generate Tube")
  

  function updateCamera(t){
    const time = t * 0.5;
    const p = ( time % LOOP_TIME) / LOOP_TIME;
    const next = (p+0.03);
    const pos = tube.geometry.parameters.path.getPointAt(p);
    const nextPos = tube.geometry.parameters.path.getPointAt(next);
    worldEnv.camera.position.copy(pos);
    worldEnv.camera.lookAt(nextPos);
    worldEnv.camera.rotation.z += 0.01
    worldEnv.camera.rotation.z += 0.01
    worldEnv.camera.rotation.y += 0.01
  }
  let t = 0;


  function animate(){
    //render frame
    updateCamera(t)
    worldEnv.composer.render(worldEnv.scene,worldEnv.camera);
    
    //get current audio data
    audioEnv.analyser.getByteFrequencyData(audioEnv.byteFrequencyData);
    audioEnv.analyser.getByteTimeDomainData(audioEnv.timeDomainData);
    const {adjustedAverage} = audioEnv.getAverageLoudness();
    worldEnv.bloomPass.strength = (adjustedAverage/255) * 150    
    console.log('bloom strength:',worldEnv.bloomPass.strength);

    worldEnv.renderer.domElement.style.filter = `hue-rotate(${t/(HUE_ROTATE_AMOUNT)}deg)`
    t++;

    setTimeout(()=>{
      requestAnimationFrame(animate)
    },17) //~60fps
  }

  return { worldEnv, animate}

}


function main(){
  const startButton = document.querySelector("#start")
  startButton.addEventListener("click",async ()=>{
    const visualizer = await initializeVisualizer();
    startButton.style.display = "none"
    visualizer.animate()

  })
}

main();