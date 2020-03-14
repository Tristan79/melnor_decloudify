'use strict';

const dns = require('./dnsTools');
const web = require('./web');
const { QLog } = require('quanto-commons');

// # simple shell one-liner to decode the payload of a wireshark WS frame
// cat | sed "s/.*{/{/" | tee /dev/stderr | sed "s/.*data.....//"| sed "s/.....channel.*//"
// # simple one liner to decode message=<base64> payload
// cat | sed "s/.*message=//" | base64 -D | hexdump

// The STATE field
// STAT 0x1 = connected ?
// STAT 0x2 = handshake ?
// STAT 0x4 = ??
// STAT 0x8 = ??
// STAT = 02 = 0x2  -> handshake
// STAT = 03 = 0x1 + 0x2 -> connected
// STAT = 0C = 12 = 0x4 + 0x8

// What is the last INT? 
// STAT2 = 0x0 ??
// STAT2 = 0x2 ??

// Bytes still need to be decoded
// MAC2 MAC1 MAC0 STAT TIME VALV CHNL ???? ???? ???? STAT2
// ========================================================
// 6e05 f379 ec7c 0200 1103 0000 0000 0000 0000 0000 0000 -> Device handshake running, no hashkey yet (Time 31s)
// Set timestamp C3 03 03 in Time 41s
// MAC2 MAC1 MAC0      TIME
// 6e05 f379 ec7c 0300 c303 e2dc 00f5 0000 0000 0000 0000 -> Device handshake done, all OFF (Time 51s)
// Turn CH01 on in Time 74s for 30 minutes (e2dc e203 0000 ...) -> until timer reaches e2
// MAC2 MAC1 MAC0      TIME
// 6e05 f379 ec7c 0300 c303 e2dc 11f5 0000 0000 0000 0000 -> Channel 1 on (Time 101s)
// Set timestamp C5 03 03 in Time 101s
// MAC2 MAC1 MAC0 STAT TIME VALV CHNL
// 6e05 f379 ec7c 0300 f803 e2dc 00f5 0000 0000 0000 0000 -> Channel 1 off (Time, approx 3060s)
// MAC2 MAC1 MAC0      TIME
// 6e05 f379 ec7c 0000 1d00 0000 0000 0000 0000 0000 0000 ->  ??
//
// 44da f279 ec7c 0300 6404 e2dc 00c8 0000 0000 0000 0002 -> submit with valid valveId
// Invalid states or other use??
// 6ac7:228b:efad:8a67:acb5:a9a9:7af9:edfb:e69c:93ef:a7ba:59
// 6ac7:228b:efa6:6a7b:9a95:cb6b:95eb:e7b7:ef9a:724f:be9e:e965
// 6ac7:228b:efa6:6a7b:9a95:cb6b:95eb:e7b7:ef9a:724f:be9e:e965
// no valve connected?
// MAC2 MAC1 MAC0      TIME
// ffff:ffff:ffff:0000:0002:0000:0000:0002:0000:0000:0002

// MAC2 MAC1 MAC0:????:TIME:VALV:CHAN:
// ch 1,2,3 on
// 44da:f279:ec7c:0c00:0360:e2dc:07ff:0000:0000:0000:0000
// channel 2 + 4 on
// 44da:f279:ec7c:0c00:0360:e2dc:0aff:0000:0000:0000:0000
// channel 2 on
// 44da:f279:ec7c:0c00:0360:e2dc:02ff:0000:0000:0000:0000
// all channels on
// 44da:f279:ec7c:0c00:0360:e2dc:0fff:0000:0000:0000:0000
// 0x7 = 0x1 + 0x2 + 0x4 + 0x8

// manual_sched events sent to the device to turn on / off valves
// 
// {"event":"manual_sched","data":"\"IMQAAAAAAAAAAAAAAAAAAAAA\"","channel":settings.mac}
// IMQAAAAAAAAAAAAAAAAAAAAA
// 0000000 e2 dc 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
// channel 1 ON
// {"event":"manual_sched","data":"\"IMR0AgAAAAAAAAAAAAAAAAAA\"","channel":settings.mac}
// IMR0AgAAAAAAAAAAAAAAAAAA
// 0000000 e2 dc 74 02 00 00 00 00 00 00 00 00 00 00 00 00 00 00
// ???
// {"event":"manual_sched","data":"\"IMTpAgYDAAAAAAAAAAAAAAAA\"","channel":settings.mac}
// IMTpAgYDAAAAAAAAAAAAAAAA
// 0000000 e2 dc e9 02 06 03 00 00 00 00 00 00 00 00 00 00 00 00
// {"event":"manual_sched","data":"\"IMQAAO4CAAAAAAAAAAAAAAAA\"","channel":settings.mac}
// 0000000 e2 dc 00 00 ee 02 00 00 00 00 00 00 00 00 00 00 00 00
// ??? channel 1 / 10
// {"event":"manual_sched","data":"\"IMQHAwAAAAAAAAAAAAAAAAAA\"","channel":settings.mac}
// 0000000 e2 dc 07 03 00 00 00 00 00 00 00 00 00 00 00 00 00 00
// ??? channel 1 / 30
// {"event":"manual_sched","data":"\"IMQcAwAAAAAAAAAAAAAAAAAA\"","channel":settings.mac}
// 0000000 e2 dc 1c 03 00 00 00 00 00 00 00 00 00 00 00 00 00 00
// ??? channel 2 / 10
// {"event":"manual_sched","data":"\"IMQAAAwDAAAAAAAAAAAAAAAA\"","channel":settings.mac}
// 0000000 e2 dc 00 00 0c 03 00 00 00 00 00 00 00 00 00 00 00 00
// ??? channel 2 / 45
// {"event":"manual_sched","data":"\"IMQAAC8DAAAAAAAAAAAAAAAA\"","channel":settings.mac}
// 0000000 e2 dc 00 00 2f 03 00 00 00 00 00 00 00 00 00 00 00 00
// ?? channel 2 / 60
// {"event":"manual_sched","data":"\"IMQAAD8DAAAAAAAAAAAAAAAA\"","channel":settings.mac}
// 0000000 e2 dc 00 00 3f 03 00 00 00 00 00 00 00 00 00 00 00 00
// ?? channel 2 / ON -> 60

const log = QLog.scope('MAIN');
log.info('Melnor Aqua Timer Decloudifier starting...');

dns.start();
web.start();
