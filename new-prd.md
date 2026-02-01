# 新的需求
开始之前，请你先阅读constitution.md

需求介绍：现在的“航路规划”页面需要增加一个能力，右上角加上一个switch（是否追踪vatsim）和一个input（CID输入），开启之后追踪vatsim位置。

## 详细要求
1. 位置获取：通过请求这个接口获取：https://data.vatsim.net/v3/vatsim-data.json。他的请求示例如下。你需要根据cid筛选出用户，然后根据他的latitude、longitude确定位置，再用heading确定地图上他的标识的朝向
``` json
{
    "pilots": [
        {
"cid": 1859575,
"name": "Szymon Kozlowski EPWR",
"callsign": "CPA271",
"server": "GERMANY2",
"pilot_rating": 0,
"military_rating": 0,
"latitude": 47.15141,
"longitude": 21.15697,
"altitude": 33940,
"groundspeed": 497,
"transponder": "2000",
"heading": 304,
"qnh_i_hg": 29.86,
"qnh_mb": 1011,
"flight_plan": {
"flight_rules": "I",
"aircraft": "A35K/H-SDE2E3GHIJ3J4J5LM1ORWXY/LB1D1",
"aircraft_faa": "H/A35K/L",
"aircraft_short": "A35K",
"departure": "VHHH",
"arrival": "EHAM",
"alternate": "EHEH",
"cruise_tas": "495",
"altitude": "34100",
"deptime": "1805",
"enroute_time": "1326",
"fuel_time": "1459",
"remarks": "PBN/A1B1C1D1L1O1S2 DOF/260131 REG/BLXP EET/ZGZU0014 ZPKM0113 ZLHW0232 ZWUQ0412 UAAA0530 UACN0629 UATT0706 UBBA0831 UGGG0858 LTAA0923 UGGG0924 LTAA0932 LTBB1038 LBSR1042 LRBB1101 LHCC1140 LZBB1155 LKAA1203 EDUU1228 EDVV1245 EHAA1303 OPR/CPA PER/D RMK/TCAS SIMBRIEF /V/",
"route": "ATENA1X BEKOL A461 SHL W22 TEPID W24 OSNOV G586 QP B330 ELKAL W179 IGNAK/K0911S1010 W179 WFX/K0904S1040 W179 OMBON DCT ANDIM B215 IBANO G470 AKLAS W192 FKG A368 SARIN/K0889F340 N161 GASBI/N0487F340 N161 LEYLA N644 LAGAS DCT SARPI UM10 OLUPO/N0493F360 UM10 GOKPA UL746 ODERO DCT OPT DCT IRLOX DCT GANNA DCT PATAK DCT KATQA DCT KILNU DCT KATCE DCT NORKU NORKU2A",
"revision_id": 1,
"assigned_transponder": "0000"
},
"logon_time": "2026-01-31T17:04:49.6585958Z",
"last_updated": "2026-02-01T05:43:48.198199Z"
},
    ]
}

```
