// Same CC0 VSCO samples, delivered in bounded static chunks.
(() => {
 const paths=["sample-part-1.json","sample-part-2.json","sample-part-3.json","sample-part-4.json","sample-part-5.json","sample-part-6.json","sample-part-7.json"];
 const controllers=[];
 window.ORCHESTRA_SAMPLES_CANCEL=()=>controllers.forEach(c=>c.abort());
 window.ORCHESTRA_SAMPLES_LOADER_PROMISE=(async()=>{
  const parts=new Array(paths.length);let next=0;
  const worker=async()=>{while(next<paths.length){const index=next++;const controller=new AbortController();controllers.push(controller);const response=await fetch('./assets/audio/'+paths[index],{signal:controller.signal});if(!response.ok)throw new Error('音色加载失败');parts[index]=await response.json();}};
  try{await Promise.all(Array.from({length:3},worker));window.ORCHESTRA_SAMPLES=parts.flat();}
  catch(error){window.ORCHESTRA_SAMPLES_CANCEL();throw error;}
 })();
 // Attach a rejection observer until the script onload listener reads this promise.
 window.ORCHESTRA_SAMPLES_LOADER_PROMISE.catch(()=>{});
})();
