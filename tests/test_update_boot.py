"""Run the real first-boot check against simulated SDK/FreeRTOS calls."""
import pathlib
import subprocess
import tempfile
import unittest
ROOT = pathlib.Path(__file__).resolve().parents[1]

class BootTest(unittest.TestCase):
    def test_confirmation_and_timeout(self):
        with tempfile.TemporaryDirectory() as directory:
            p = pathlib.Path(directory)
            (p/'freertos').mkdir()
            (p/'esp_err.h').write_text('''#pragma once
#include <assert.h>
typedef int esp_err_t;
#define ESP_OK 0
#define ESP_ERR_NO_MEM 1
#define ESP_ERROR_CHECK(e) assert((e)==0)
''')
            (p/'esp_log.h').write_text('#include "esp_err.h"\n#define ESP_LOGE(...) ((void)0)\n')
            (p/'esp_ota_ops.h').write_text('''#include "esp_err.h"
typedef struct { int unused; } esp_partition_t;
typedef int esp_ota_img_states_t;
#define ESP_OTA_IMG_PENDING_VERIFY 1
const esp_partition_t *esp_ota_get_running_partition(void);
int esp_ota_get_state_partition(const esp_partition_t*,int*);
int esp_ota_mark_app_valid_cancel_rollback(void);
int esp_ota_mark_app_invalid_rollback_and_reboot(void);
''')
            (p/'freertos/FreeRTOS.h').write_text('#include <stddef.h>\n#define pdPASS 1\n#define pdMS_TO_TICKS(x) (x)\n')
            (p/'freertos/task.h').write_text('''int xTaskCreate(void (*)(void*),const char*,int,void*,int,void*);
void vTaskDelay(int);
void vTaskDelete(void*);
''')
            (p/'test.c').write_text('''#include <assert.h>
#include <setjmp.h>
#include <string.h>
#include "esp_ota_ops.h"
#include "update_boot.h"
static void (*task)(void*);
static int state, ticks, confirmed, rollback, events;
static jmp_buf done;
const esp_partition_t *esp_ota_get_running_partition(void){static esp_partition_t p;return &p;}
int esp_ota_get_state_partition(const esp_partition_t *p,int *s){*s=state;return 0;}
int esp_ota_mark_app_valid_cancel_rollback(void){confirmed++;return 0;}
int esp_ota_mark_app_invalid_rollback_and_reboot(void){rollback++;return 0;}
int xTaskCreate(void (*fn)(void*),const char *n,int stack,void *arg,int pri,void *h){task=fn;return 1;}
void vTaskDelay(int ms){ticks+=ms;}
void vTaskDelete(void *p){longjmp(done,1);}
void diagnostics_event(const char *message){assert(strlen(message)>0);events++;}
int main(int argc,char **argv){
 state=argc>1 ? 1 : 2;
 update_boot_start();
 if(state==2){assert(!task&&!update_boot_pending());return 0;}
 assert(task&&update_boot_pending());
 // Missing a local task must time out even if the Zigbee task started.
 update_boot_ready(UPDATE_READY_ZIGBEE);
 if(argc>2){update_boot_ready(UPDATE_READY_INDICATOR);update_boot_ready(UPDATE_READY_PROBE);}
 if(!setjmp(done))task(0);
 if(argc>2){assert(confirmed==1&&!rollback&&events==1);assert(ticks>=3000&&ticks<30000);assert(!update_boot_pending());}
 else {assert(!confirmed&&rollback==1&&!events);assert(ticks==30000);}
 return 0;
}
''')
            executable=p/'test-boot'
            subprocess.run(['cc','-std=c11','-I'+str(p),'-I'+str(ROOT/'main'),str(ROOT/'main/update_boot.c'),str(p/'test.c'),'-o',str(executable)],check=True)
            for args in [[],['pending'],['pending','ready']]:
                subprocess.run([str(executable),*args],check=True)

if __name__ == '__main__':
    unittest.main()
