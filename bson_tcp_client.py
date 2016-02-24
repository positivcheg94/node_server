import socket
import sys
import bson
import json
import struct
import hashlib
from time import time

HOST = 'localhost'    # The remote host
PORT = 8085           # The same port as used by the server

mode = 1

class HashNotEqual(Exception):
    def __init__(this):
        super().__init__()
    def __str__(this):
        return "Hashes not equal"

class Client:

    def __init__(this):
        this._sock = None

    def connect(this, host, port, mode):
        for res in socket.getaddrinfo(host, port, socket.AF_UNSPEC, socket.SOCK_STREAM):
            af, socktype, proto, canonname, sa = res
            try:
                s = socket.socket(af, socktype, proto)
            except socket.error as msg:
                s = None
                continue
            try:
                s.connect(sa)
            except socket.error as msg:
                s.close()
                s = None
                continue
            break
            return False
        if s is None:
            return False
        this._sock = s
        this._mode = mode

    def read_packet(this):
        tmp = this._sock.recv(16)
        main_headers = struct.unpack('IIII', tmp)
        main_data = this._sock.recv(main_headers[0] - 16)
        if main_headers[3] == 2:
            data = json.loads(main_data.decode())
        else:
            data = bson.loads(main_data)
        return {
            'size': main_headers[0],
            'packet_id': main_headers[1],
            'packet_part': main_headers[2],
            'mode': main_headers[3],
            'message': data
        }

    def __receive_big_packet__(this):
        parts = []
        first_packet = this.read_packet()
        current_packet = None
        data_hash = None
        control_hash = hashlib.sha256()
        while(True):
            current_packet = this.read_packet()
            try:
                data = current_packet['message']['data']
                constrol_hash.update(data)
                parts.append(data)
            except KeyError:
                data_hash = current_packet['message']['hash']
        if data_hash == control_hash.digest():
            return first_packet,parts,data_hash
        else:
            raise HashNotEqual

    def __write_packet__(this, packet_id, packet_part, msg):
        msg['trunc']=False
        if this._mode == 2:
            packed = json.dumps(msg).encode()
        else:
            print(msg)
            packed = bson.dumps(msg)
        main_headers = struct.pack('IIII', 16 + len(packed), packet_id, packet_part, this._mode)
        buff = main_headers + packed
        this._sock.sendall(buff)

    def scan_dir(this, path):
        this.__write_packet__(0, 0, {'request': 'ls-l', 'path': path})
        return this.read_packet()

    def get_file(this, path):
        this.__write_packet__(0, 0, {
            'request': 'rest',
            'method': 'get',
            'path': path
        })
        return this.__receive_big_packet__()

    def __del__(this):
        this._sock.close()

def main():
    pass

if __name__ == "__main__":
    client = Client()
    client.connect(HOST,PORT, 1)

    #"""
    start = time()
    sc_dir = client.scan_dir('/home/yang')
    print(time()-start)
    #print(sc_dir)
    #"""
    start = time()
    sc_dir = client.scan_dir('/home/yang/calibre_library')
    print(time()-start)
    #print(sc_dir)
    start = time()
    sc_dir = client.scan_dir('/home/yang/Downloads')
    print(time()-start)
    #print(sc_dir)

    """
    start = time()
    sc_dir = client.get_file('/home/yang/test')
    print(time()-start)
    """
