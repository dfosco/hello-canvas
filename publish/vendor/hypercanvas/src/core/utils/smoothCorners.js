/**
 * Register the smooth-corners CSS Houdini paint worklet.
 *
 * Inlined from smooth-corners (MIT) to avoid Vite-specific ?url import
 * that breaks when this source is consumed from node_modules.
 *
 * Safe to call multiple times — the worklet is only registered once.
 */
let registered = false

export function registerSmoothCorners() {
  if (registered) return
  if (typeof CSS === 'undefined' || !('paintWorklet' in CSS)) return
  registered = true
  try {
    const worklet = `class P{static get inputProperties(){return["--sb--smooth-corners"]}superellipse(a,b,nX=4,nY){if(Number.isNaN(nX))nX=4;if(typeof nY==="undefined"||Number.isNaN(nY))nY=nX;if(nX>100)nX=100;if(nY>100)nY=100;if(nX<1e-11)nX=1e-11;if(nY<1e-11)nY=1e-11;const nX2=2/nX,nY2=nY?2/nY:nX2,steps=360,step=(2*Math.PI)/steps;return Array.from({length:steps},(_,i)=>{const t=i*step,cosT=Math.cos(t),sinT=Math.sin(t);return{x:Math.abs(cosT)**nX2*a*Math.sign(cosT),y:Math.abs(sinT)**nY2*b*Math.sign(sinT)}})}paint(ctx,geom,props){const[nX,nY]=props.get("--sb--smooth-corners").toString().replace(/ /g,"").split(",");const w=geom.width/2,h=geom.height/2,s=this.superellipse(w,h,parseFloat(nX),parseFloat(nY));ctx.fillStyle="#000";ctx.setTransform(1,0,0,1,w,h);ctx.beginPath();for(let i=0;i<s.length;i++){const{x,y}=s[i];i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)}ctx.closePath();ctx.fill()}}try{registerPaint("smooth-corners",P)}catch(e){}`
    const blob = new Blob([worklet], { type: 'application/javascript' })
    CSS.paintWorklet.addModule(URL.createObjectURL(blob))
  } catch { /* empty */ }
}
