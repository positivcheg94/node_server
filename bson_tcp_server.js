#! /usr/bin/node

const net = require('net')
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
const mHead = pHead.message

// requests
const rq = config.request
const restAPI = rq.restAPI
const rqDir = rq.dir

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

// packet processing related functions
function packPacket(pId, pPart, msg) {
   if (DEBUG) {
      console.log('outgoing message')
      console.log(msg)
   }
   var bsonPacket = BSON.serialize(msg)
   var totalSize = bsonPacket.length + 12
   var headers = new Buffer(new Uint32Array([totalSize, pId, pPart]).buffer)
   return new Buffer.concat([headers, bsonPacket])
}

function packPacketTrunc(pId, pPart, pTruncated, message) {
   message[mHead.truncated] = pTruncated
   var bsonPacket = BSON.serialize(message)
   var totalSize = bsonPacket.length + 12
   var headers = new Buffer(new Uint32Array([totalSize, pId, pPart]).buffer)
   return new Buffer.concat([headers, bsonPacket])
}

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
   var msg = BSON.deserialize(data.slice(12))
   if (DEBUG) {
      console.log('incomming message')
      console.log(msg)
   }
   return {
      [binHead.pId]: data.readUInt32LE(4),
      [binHead.pPart]: data.readUInt32LE(8),
      [mHead.name]: msg
   }
}


var server = net.createServer((socket) => { //'connection' listener
   var client_public_key = null

   var packetPool = null

   var incomingPacket = {
      packet_size: 0,
      bytes_received: 0,
      buff: null
   }
   var outgoingPacketId = new autoincrementId()

   socket.setTimeout(config.socket_timeout, () => {
      console.log('timeout event')
      socket.end()
      socket.destroy()
   })

   // log connection
   console.log(socket.address().address, ' - client connected')


   // processing deserialised packet
   socket.on(socEvent.pUnpack, (bsonPacket) => {
      //try {
      var jsonPacketPart = unpackPacket(bsonPacket)
      if (jsonPacketPart[binHead.pPart] == 0 && !jsonPacketPart[mHead.name][mHead.truncated]) {
         socket.emit(socEvent.request, jsonPacketPart[mHead.name])
      } else {
         socket.emit(socEvent.pAssembly, jsonPacketPart)
      }
      //} catch (error) {
      //   socket.emit(socEvent.hError, error)
      //}
   })

   // assembly messages with more than 1 part
   socket.on(socEvent.pAssembly, (jsonPacketPart) => {
      console.log('assembly')
   })

   // message with more than 1 part
   // socket.on(socEvent.bigMessage, (message) => {})

   socket.on(socEvent.request, (request) => {
      //try {
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
                        socket.emit(socEvent.response, request, dir_entries)
                     }
                  })
               })
            })
            break
         case restAPI.name:
            console.log("RESTAPI")
            switch (request.method) {
               case restAPI.method.get:
                  console.log("RESTAPI get")
                  var fPath = request[rq.path]
                  var fName = path.basename(fPath)
                  var fStream = fs.createReadStream(fPath)
                  socket.emit(socEvent.sendStream, request, {
                     filename: fName
                  }, fStream)
                  break
            }
            break

         default:
            socket.emit(socEvent.hError, 'unknown error')
      }
      //} catch (error) {
      //   socket.emit(socEvent.hError, error)
      //}

   })

   socket.on(socEvent.response, (request, response) => {
      socket.emit(socEvent.send, outgoingPacketId.get(), 0, {
         [mHead.request]: request,
         [mHead.response]: response
      }, false)
   })

   socket.on(socEvent.send, (pId, pPart, jsonPart, pTruncated) => {
      if (pTruncated === undefined) {
         socket.write(packPacketTrunc(pId, pPart, false, jsonPart))
      } else {
         socket.write(packPacketTrunc(pId, pPart, pTruncated, jsonPart))
      }
   })

   socket.on(socEvent.sendStream, (request, message, readableStream) => {
      var streamId = outgoingPacketId.get()
      var streamPart = new autoincrementId()

      socket.emit(socEvent.send, streamId, streamPart.get(), {
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
         socket.emit(socEvent.send, streamId, streamPart.get(), {
            data: chunk
         })
      })

      readableStream.on('end', () => {
         socket.emit(socEvent.send, streamId, streamPart.get(), {
            hash: hash.digest()
         })
         socket.removeListener(socEvent.closeStream, closeListener)
      })
   })


   socket.on(socEvent.data, (data) => {
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
            socket.emit(socEvent.hError, {
               name: 'Client handler error',
               message: 'Too small packet',
               toString: function() {
                  return this.name + ": " + this.message
               }
            })
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
