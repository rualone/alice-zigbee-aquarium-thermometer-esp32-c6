"""Host checks of the actual Zigbee health request state machine."""
from pathlib import Path
import subprocess
import tempfile
import unittest

class HealthTest(unittest.TestCase):
    def test_request_lifecycle(self):
        root=Path(__file__).resolve().parents[1]
        source=r'''#include <assert.h>
#include "zigbee_health.h"
int main(void) {
 zigbee_health_t h={0};
 uint32_t first=zigbee_health_begin(&h,100);
 assert(h.pending && h.started_ms==100);
 assert(zigbee_health_finish(&h,first,false,200));
 assert(h.failures==1 && h.next_ms==10200);
 assert(!zigbee_health_finish(&h,first,true,300)); // duplicate reply
 uint32_t second=zigbee_health_begin(&h,10200);
 assert(!zigbee_health_finish(&h,first,true,10300)); // late reply
 assert(h.pending && h.failures==1);
 assert(zigbee_health_finish(&h,second,false,30200)); // watchdog timeout
 assert(h.failures==2);
 for(int i=0;i<10;i++) {
  uint32_t token=zigbee_health_begin(&h,40000+i);
  assert(zigbee_health_finish(&h,token,false,40001+i));
 }
 assert(h.failures==2); // saturates: no overflow after long outage
 uint32_t token=zigbee_health_begin(&h,50000);
 assert(zigbee_health_finish(&h,token,true,50001));
 assert(h.failures==0 && h.next_ms==60001);
 token=zigbee_health_begin(&h,60001);
 zigbee_health_reset(&h); // leave/reset invalidates outstanding response
 assert(!zigbee_health_finish(&h,token,true,60002));
 assert(!h.pending && h.failures==0 && h.next_ms==0);
 h.generation=UINT32_MAX;
 assert(zigbee_health_begin(&h,70000)==1);
 return 0;
}
'''
        with tempfile.TemporaryDirectory() as temp:
            folder=Path(temp);(folder/'test.c').write_text(source)
            subprocess.run(['cc','-std=c11','-Wall','-Wextra','-Werror','-I',str(root/'main'),str(folder/'test.c'),'-o',str(folder/'test')],check=True)
            subprocess.run([str(folder/'test')],check=True)

if __name__=='__main__': unittest.main()
