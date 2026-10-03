/* Load a class in one request; keep recordings on this device for repeat visits. */
const RecordedWords = (()=>{
  const buffers=new Map(), pending=new Map(), urls=new Map(), players=new Map();
  async function loadPack(grade){
    if(buffers.has(grade))return;
    if(pending.has(grade))return pending.get(grade);
    const task=(async()=>{
      const pack=AUDIO_PACKS[grade];if(!pack)return;
      let cache=null,response=null;
      try{if(window.caches){cache=await window.caches.open('slovarik-audio-v5');response=await cache.match(pack.file);}}catch{}
      if(response){
        try{const saved=await response.arrayBuffer();if(saved.byteLength===pack.bytes){buffers.set(grade,saved);return;}}catch{}
        response=null;try{await cache.delete(pack.file);}catch{}
      }
      if(!response){response=await fetch(pack.file);if(!response.ok)throw new Error('Не удалось загрузить записи.');}
      const copy=response.clone(), buffer=await response.arrayBuffer();
      if(buffer.byteLength!==pack.bytes)throw new Error('Запись загружена не полностью.');
      buffers.set(grade,buffer);
      if(cache){try{await cache.put(pack.file,copy);}catch{}}
    })();
    pending.set(grade,task);
    try{await task;}finally{pending.delete(grade);}
  }
  function warm(words){for(const grade of new Set(words.map(w=>w.grade)))loadPack(grade).catch(()=>{});}
  function get(word){
    const item=AUDIO_INDEX[word.id];let file=AUDIO_FILES[word.id]?AUDIO_FILES[word.id]+'?v=5':null;
    if(item && buffers.has(item.grade)){
      if(!urls.has(word.id)){
        const data=buffers.get(item.grade).slice(item.offset,item.offset+item.length);
        urls.set(word.id,URL.createObjectURL(new Blob([data],{type:'audio/mpeg'})));
      }
      file=urls.get(word.id);
    }
    if(!file)return null;
    if(!players.has(file)){const audio=new Audio(file);audio.preload='auto';players.set(file,audio);}
    return players.get(file);
  }
  return {warm,get};
})();
