#! /usr/bin/node

const net = require('net')
const dgram = require('dgram')
const buffer = require('buffer')
const crypto = require('crypto');
const fs = require('fs')
const path = require('path')

const bson = require("bson");
const BSON = new bson.BSONPure.BSON();

// config file
const config = require('./config.json')

// socket events
const socEvent = config.socket

// packet headers
const pHead = config.pHeaders
const binHead = pHead.binary
const pMode = binHead.mode
const mHead = pHead.message

// requests
const rq = config.request
const rqDir = rq.dir
const restAPI = rq.restAPI
const dgramCon = rq.dgramCon


//responses
const rp = config.response
const rpDir = rp.dir

// DEBUG
const DEBUG = true

// get config values
const root_dir = config.server_root_dir

// generate keys
//var keys = crypto.createDiffieHellman(config.prime_length);
//keys.generateKeys();
//var keys_length = keys.getPublicKey().length

/*
console.log('Length - ' + keys.getPublicKey().length.toString() + ' - ' + keys.getPrivateKey().length.toString())
console.log("Public Key : ", keys.getPublicKey());
console.log("Private Key : ", keys.getPrivateKey());
console.log("\n##################")
console.log("Public Key : ", keys.getPublicKey('binary'));
console.log("Private Key : ", keys.getPrivateKey('binary'));
*/

// auto increment class for counting packets and parts
function autoincrementId() {
   this.id = 0
}
autoincrementId.prototype.get = function() {
   if (this.id === 4294967295) {
      return this.id = 0
   } else
      return this.id++
}
autoincrementId.prototype.check = function() {
   return this.id
}
autoincrementId.prototype.toString = function() {
   return this.id.toString()
}

function PacketManager(banCallback, endCallback) {
   this.banCallback = banCallback
   this.endCallback = endCallback
   this.tPackets = {}
}
/*
PacketManager.prototype.manage = function(pid, part){
   if (mHead.end in part){
      this.parts[++this.currParts] = part
      this.endCallback(parts)
   }
   else if (this.currParts>this.approxPThreshH){
      this.banCallback(this.id)
   }
   else{
      this.parts[++this.currParts] = part
   }
}
*/

// packet processing related functions
function packPacket(pId, pPart, mode, message, pTruncated) {
   if (pTruncated !== undefined) {
      message[mHead.truncated] = pTruncated
   }
   if (DEBUG) {
      console.log('outgoing message')
      console.log(message)
   }
   switch (mode) {
      case pMode.json:
         var packet = Buffer(JSON.stringify(message))
         break;
      default:
         var packet = BSON.serialize(message)
   }
   var totalSize = packet.length + 16
   var headers = Buffer(new Uint32Array([totalSize, pId, pPart, mode]).buffer)

   return new Buffer.concat([headers, packet])
}

function unpackBinaryHeaders(data) {
   return {

   }
}

/* better to place this directly in socket.on because of easier exceptions handling
function unpackPacket(data) {
   var totalSize = data.readUInt32LE()
   if (totalSize != data.length)
      throw {
         name: 'Unpack packet',
         message: 'Size missmatch',
         toString: function() {
            return this.name + ": " + this.message
         }
      }
   var binPacket = data.slice(16)
   var mode = data.readInt32LE(12)
   switch (mode) {
      case pMode.json:
         var msg = JSON.parse(binPacket.toString())
         break;
      default:
         var msg = BSON.deserialize(binPacket)
   }

   if (DEBUG) {
      console.log('incomming message')
      console.log(msg)
   }
   return msg
}
*/

var server = net.createServer((socket) => { //'connection' listener
   //var client_public_key = null

   var bannedPackets = new Set()
   var banCallback = (pId) => {
      bannedPackets.add(pId)
   }

   var clientAdress = socket.address().address

   // Not "today"
   // I will implement udp file exhange later
   /*
   var dgramSocket = dgram.createSocket(config.dgramType)

   dgramSocket.on('message', (message, rinfo)=>{
      console.log('${rinfo.address}:${rinfo.port} - $message')
   })
   dgramSocket.on('error',(error)=>{
      console.log(error)
   })
   if (!dgramSocket.bind()){
      var dgramSocket = null
   }
   */

   var incomingPacket = {
      packet_size: 0,
      bytes_received: 0,
      buff: null
   }

   var outgoingPacketId = new autoincrementId()

   socket.setTimeout(config.socketTimeout, () => {
      console.log('timeout event')
      socket.end()
      socket.destroy()
   })

   // log connection
   console.log(clientAdress, ' - client connected')


   // processing deserialised packet
   socket.on(socEvent.pUnpack, (rawPart) => {
      pId = rawPart.readUInt32LE(4)
      if (pId in bannedPackets) {
         // no logging but w/e, maybe I will add it later
         return
      }
      var pSize = rawPart.readUInt32LE()
      var pPart = rawPart.readUInt32LE(8)
      var pMode = rawPart.readInt32LE(12)
      var binPacket = rawPart.slice(16)
      try {
         switch (pMode) {
            case pMode.json:
               var msg = JSON.parse(binPacket.toString())
               break;
            default:
               var msg = BSON.deserialize(binPacket)
         }
      } catch (error) {
         socket.emit(socEvent.hError, error)
      }

      if (DEBUG) {
         console.log('incomming message')
         console.log(msg)
      }

      try {
         if (msg[mHead.truncated]) {
            // start packet chain
            // rework inc
            socket.emit(socEvent.pAssembly, msg)
         } else {
            socket.emit(socEvent.request, msg)
         }
      } catch (error) {
         if (pPart == 0) {
            socket.emit(socEvent.hError, "0 part, no truncated header")
         } else {
            // continue packet chain
            // rework inc
            socket.emit(socEvent.pAssembly, msg)
         }
      }
   })

   // assembly messages with more than 1 part
   socket.on(socEvent.pAssembly, (packetPart) => {
      // I will implement this soon
      // or redesing the way big messages are handled
   })

   // message with more than 1 part
   // socket.on(socEvent.bigMessage, (message) => {})

   socket.on(socEvent.request, (request) => {
      try {
         console.log(socket.address().address, 'request - ', request[mHead.request])
         switch (request[mHead.request]) {
            case rqDir.name:
               var dPath = request[rq.path]
               fs.readdir(dPath, (error, files) => {
                  if (error) socket.emit('error', error)
                  var dir_entries = {
                     [rpDir.d]: [],
                     [rpDir.f]: []
                  }
                  var len = files.length
                  files.forEach((elem, id, array) => {
                     fs.stat(path.join(dPath, elem), (error, stats) => {
                        if (error) socket.emit('error', error)
                        if (stats.isDirectory())
                           dir_entries.dirs.push(elem)
                        else
                           dir_entries.files.push(elem)
                        if (--len === 0) {
                           socket.emit(socEvent.response, request, pMode.json, dir_entries)
                        }
                     })
                  })
               })
               break
            case restAPI.name:
               switch (request.method) {
                  case restAPI.method.get:
                     var fPath = request[rq.path]
                     var fName = path.basename(fPath)
                     var fStream = fs.createReadStream(fPath)
                     socket.emit(socEvent.sendStream, request, {
                        filename: fName
                     }, fStream)
                     break
               }
               break
            case dgramCon.name:
               var port = (dgramSocket === null) ? null : dgramSocket.address().port
               socket.emit(socEvent.response, request, pMode.json, {
                  [dgramCon.port]: port
               })
            default:
               socket.emit(socEvent.hError, 'unknown error')
         }
      } catch (error) {
         socket.emit(socEvent.hError, error)
      }

   })

   socket.on(socEvent.response, (request, mode, response) => {
      socket.emit(socEvent.send, outgoingPacketId.get(), 0, mode, {
         [mHead.request]: request,
         [mHead.response]: response
      }, false)
   })

   socket.on(socEvent.send, (pId, pPart, mode, jsonPart, pTruncated) => {
      if (pTruncated === undefined) {
         socket.write(packPacket(pId, pPart, mode, jsonPart))
      } else {
         socket.write(packPacket(pId, pPart, mode, jsonPart, pTruncated))
      }
   })

   socket.on(socEvent.sendStream, (request, message, readableStream) => {
      var streamId = outgoingPacketId.get()
      var streamPart = new autoincrementId()

      socket.emit(socEvent.send, streamId, streamPart.get(), pMode.json, {
         [mHead.request]: request,
         [mHead.response]: message
      }, true)

      var hash = crypto.createHash('sha256')

      var closeListener = () => {
         readableStream.close()
      }
      socket.once(socEvent.closeStream, closeListener)

      readableStream.on('data', (chunk) => {
         hash.update(chunk)
         socket.emit(socEvent.send, streamId, streamPart.get(), pMode.bson, {
            data: chunk
         })
      })

      readableStream.on('end', () => {
         socket.emit(socEvent.send, streamId, streamPart.get(), pMode.bson, {
            hash: hash.digest()
         })
         socket.removeListener(socEvent.closeStream, closeListener)
      })
   })


   socket.on(socEvent.data, (data) => {
      // not sure about this, maybe while data.length > 0 is better
      // but logicaly to expect, that client won't send in one tcp message
      // more than one packet or the bytes left from the incomming packet
      // anyways, this part needs a rework a bit later

      if (incomingPacket.packet_size != 0) {

         data.copy(incomingPacket.buff, incomingPacket.bytes_received)
         incomingPacket.bytes_received += data.length

         if (incomingPacket.packet_size == incomingPacket.bytes_received) {
            socket.emit(socEvent.pUnpack, incomingPacket.buff)
            incomingPacket.buff = null
            incomingPacket.packet_size = 0
         }
      } else {
         if (data.length < 4) {
            socket.emit(socEvent.hError, 'Too small packet')
         }

         var size = data.readUInt32LE()

         if (size == data.length) {
            socket.emit(socEvent.pUnpack, data)
         } else {
            incomingPacket.buff = buffer.Buffer(size)
            data.copy(incomingPacket.buff)
            incomingPacket.packet_size = size
            incomingPacket.bytes_received = data.length
         }
      }

   })

   socket.on(socEvent.hError, (error) => {
      console.log('error event')
      console.log(error)
      socket.emit(socEvent.closeStream)
      socket.end()
      socket.destroy()
   })
   socket.on(socEvent.end, () => {
      console.log('end event')
   })
})

/*
process.on('uncaughtException',(exception)=>{
   server.emit('error', exception)
})

server.on('error',(error)=>{
   console.log('server error', error)
})
*/

server.listen(8085, () => { //'listening' listener
   console.log('server bound')
})
