import "./style.css"
import { Vector3, Vector2, CatmullRomCurve3, TubeGeometry, EdgesGeometry, LineBasicMaterial, LineSegments, WebGLRenderer, Scene, PerspectiveCamera, FogExp2, ACESFilmicToneMapping, SRGBColorSpace, MathUtils, SphereGeometry, Mesh, MeshBasicMaterial, DoubleSide } from "three"
import { RenderPass, UnrealBloomPass, EffectComposer } from "three/examples/jsm/Addons.js";

const AudioContext = window.AudioContext || window.webkitAudioContext


const TUBE_SEGMENTS = 222;
const TUBE_RADIUS = 0.65;
const RADIAL_SEGMENTS = 16;
const LOOP_TIME = 5_000;
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
    renderer.domElement.style.zIndex = "1"
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
    let sum = 0, activeCount = 1, bassSum;
    const mid = this.analyser.frequencyBinCount/2

    for(let i = 0; i < this.analyser.frequencyBinCount; i++){
      if(i === mid) bassSum = sum

      if(this.byteFrequencyData[i]){
        sum += this.byteFrequencyData[i]
        activeCount++
      }
    }

    if(activeCount > 1) activeCount--;
    const average = sum / this.analyser.frequencyBinCount;
    const activeAverage = sum/activeCount;
    const adjustedAverage = (average+activeAverage/2)
    const bassAvg =  bassSum / mid
    const trebAvg = (sum-bassSum) / mid
    return {
      average,activeAverage,adjustedAverage,
      bassAvg, trebAvg
    }
  }

  //gets a smaller array of averaged values for equal sized bins
  getSimplifiedValues(binsArray){
    const nBins = binsArray.length
    const maxFFTIdx = Math.floor(0.7*this.analyser.frequencyBinCount)
    const fftBinsPerBin =  Math.floor(maxFFTIdx / nBins)
    let f = 0 //current fft idx
    for(let i = 0; i < nBins;i++){
      let sum = 0
      for(let j = 0; j < fftBinsPerBin;j++){
        sum += this.byteFrequencyData[f]
        f++
      }
      binsArray[i] = (sum/fftBinsPerBin)/255
    }

  
  }

} 






/**
 * 
 * @param {number} n 
 * @param {Scene} scene 
 */
function addStars(n,scene){
  const stars = []
  for(let i = 0; i < n; i++){
    const x = MathUtils.randFloat(-500,500)
    const y = MathUtils.randFloat(-500,500)
    const z = MathUtils.randFloat(-500,500)

    const star = new Mesh(
        new SphereGeometry(Math.random()),
        new MeshBasicMaterial({
          color: 0xffffff,
          wireframe: true,
          side: DoubleSide
        })
    )
    star.position.set(x,y,z)
    stars.push(star)
    scene.add(star)
  }
  return stars






}



async function initializeVisualizer(){
  const audioEnv = await AudioEnvironment.use()
  if(!audioEnv) {
    return console.error("failed to get audio environment... cannot start visualizer");
  }

  const worldEnv = getVisualEnvironment(0);
  const stars = addStars(audioEnv.analyser.frequencyBinCount,worldEnv.scene)
  const tube = getCircleTube(100,500);
  worldEnv.scene.add(tube.visual);

  /**
   * @type {null|HTMLCanvasElement}
   */
  const canvas2d = document.querySelector("canvas#simpleViz")
  canvas2d.width = 400
  canvas2d.height = 200
  const ctx2d = canvas2d.getContext("2d");
  
  
  const COLORS = [ 
    "#ff00ff",
    "#ff10ff",
    "#ff20ff",
    "#ff30ff",
    "#ff40ff",
    "#ff50ff",
    "#ff60ff",
    "#ff70ff",
    "#ff80ff",
    "#ff90ff",

    
  ]


  function drawBars(simple){
    let c = 0; 
    ctx2d.fillStyle = "#ffffff"
    ctx2d.strokeStyle = "#ffffff"
    const barWidth = 400/simple.length
    for(let b = 0; b < simple.length; b++){
      const x = b*barWidth
      const height = (simple[b] * 250 )
      ctx2d.fillStyle=COLORS[b]
      ctx2d.fillRect(x,0,barWidth,height)

    }
  }



  

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
  let t = 65; //"tube" time
  let ct = 0; //"color" time
  const simple = Array(10).fill(0)

  function animate(){
    //render frame
    updateCamera(t)
    worldEnv.composer.render(worldEnv.scene,worldEnv.camera);
    
    //get current audio data
    audioEnv.analyser.getByteFrequencyData(audioEnv.byteFrequencyData);
    audioEnv.analyser.getByteTimeDomainData(audioEnv.timeDomainData);
    audioEnv.getSimplifiedValues(simple)
    
    
    

    const {adjustedAverage, trebAvg, bassAvg} = audioEnv.getAverageLoudness();
    worldEnv.bloomPass.strength = (adjustedAverage/255) * 150    

    const scaleAmount =  0.2*Math.sin((bassAvg +ct)/1000)
    const s = 1 + scaleAmount
    tube.visual.scale.set(1,1,s);


    worldEnv.renderer.domElement.style.filter = `hue-rotate(${(ct+trebAvg)/(HUE_ROTATE_AMOUNT)}deg)`
    canvas2d.style.filter = `hue-rotate(${(ct+trebAvg)/(HUE_ROTATE_AMOUNT)}deg) contrast(${Math.min(Math.abs(bassAvg-trebAvg),5)}) blur(15px)`
    t++;
    ct++
    if(t > 1000 ) t  = 144

    for(const star of stars){
      star.scale.set(trebAvg/255,(trebAvg+bassAvg)/2/255,trebAvg/255)
    }
    
    ctx2d.clearRect(0,0,400,200) 
    drawBars(simple);


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