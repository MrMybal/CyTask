import {deflateRawSync} from "node:zlib";
const table=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc=bytes=>{let value=0xffffffff;for(const byte of bytes)value=table[(value^byte)&255]^(value>>>8);return (value^0xffffffff)>>>0;};
/** Deterministic UTF-8 ZIP used for the complete, self-contained offline reader. */
export function zip(files){
 const local=[],central=[];let offset=0,size=0;
 for(const [name,bytes]of files){
  if(name.includes("..")||name.startsWith("/")||name.includes("\\"))throw Error("Unsafe archive path");
  const filename=Buffer.from("Documentation/"+name),compressed=deflateRawSync(bytes,{level:9}),checksum=crc(bytes);
  const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(8,8);
  header.writeUInt16LE(0x5821,12);header.writeUInt32LE(checksum,14);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(bytes.length,22);header.writeUInt16LE(filename.length,26);
  local.push(header,filename,compressed);
  const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x800,8);entry.writeUInt16LE(8,10);entry.writeUInt16LE(0x5821,14);
  entry.writeUInt32LE(checksum,16);entry.writeUInt32LE(compressed.length,20);entry.writeUInt32LE(bytes.length,24);entry.writeUInt16LE(filename.length,28);entry.writeUInt32LE(offset,42);
  central.push(entry,filename);size+=entry.length+filename.length;offset+=header.length+filename.length+compressed.length;
 }
 if(files.length>65535||offset>0xffffffff)throw Error("Documentation archive exceeds ZIP32 limits");
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(size,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...local,...central,end]);
}
