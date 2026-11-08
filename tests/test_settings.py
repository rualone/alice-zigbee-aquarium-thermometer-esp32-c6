"""Run real settings.c against an in-memory NVS implementation (no board required)."""
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]

class SettingsTest(unittest.TestCase):
    def test_migration_validation_and_storage_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            p = pathlib.Path(directory)
            (p / 'freertos').mkdir()
            (p / 'esp_err.h').write_text('''#pragma once
#include <stdbool.h>
#include <stdlib.h>
typedef int esp_err_t;
#define ESP_OK 0
#define ESP_ERR_NO_MEM 1
#define ESP_ERR_INVALID_ARG 2
#define ESP_ERR_NOT_SUPPORTED 3
#define ESP_ERR_NVS_NOT_FOUND 4
#define ESP_ERROR_CHECK(e) do { if(e) abort(); } while(0)
''')
            (p / 'sdkconfig.h').write_text('''#define CONFIG_AQUARIUM_RGB_BRIGHTNESS 1
#define CONFIG_AQUARIUM_SAMPLE_SECONDS 5
#define CONFIG_AQUARIUM_REPORT_SECONDS 60
#define CONFIG_AQUARIUM_DELTA_CENTI 20
''')
            (p / 'freertos/FreeRTOS.h').write_text('#define portMAX_DELAY 0\n')
            (p / 'freertos/semphr.h').write_text('''typedef int SemaphoreHandle_t;
static inline int xSemaphoreCreateMutex(void){return 1;}
static inline void xSemaphoreTake(int a,int b){}
static inline void xSemaphoreGive(int a){}
''')
            (p / 'nvs.h').write_text('''#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"
typedef int nvs_handle_t;
#define NVS_READONLY 0
#define NVS_READWRITE 1
int nvs_open(const char*,int,int*);
int nvs_get_blob(int,const char*,void*,size_t*);
int nvs_set_blob(int,const char*,const void*,size_t);
int nvs_get_i32(int,const char*,int32_t*);
int nvs_set_i32(int,const char*,int32_t);
int nvs_commit(int);
void nvs_close(int);
''')
            (p / 'test.c').write_text('''#include <assert.h>
#include <stdint.h>
#include <string.h>
#include "settings.h"
static unsigned char stored[64]; static size_t length; static int fail; static int32_t theme; static int has_theme;
int nvs_open(const char *n,int m,int *h){*h=1;return 0;}
int nvs_get_blob(int h,const char *k,void *out,size_t *n){if(!length)return 4;if(length>*n)return 9;memcpy(out,stored,length);*n=length;return 0;}
int nvs_set_blob(int h,const char *k,const void *v,size_t n){if(fail)return 9;memcpy(stored,v,n);length=n;return 0;}
int nvs_get_i32(int h,const char *k,int32_t *v){if(!has_theme)return 4;*v=theme;return 0;}
int nvs_set_i32(int h,const char *k,int32_t v){if(fail)return 9;theme=v;has_theme=1;return 0;}
int nvs_commit(int h){return fail?9:0;}
void nvs_close(int h){}
int main(void){
 settings_init();assert(settings_get().offset_centi==0);
 int32_t old[]={1,25,2,60,20};memcpy(stored,old,sizeof old);length=sizeof old;
 settings_init();aquarium_settings_t v=settings_get();assert(v.brightness==25&&v.sample_seconds==2&&v.offset_centi==0);
 v.offset_centi=-30;assert(settings_save(v)==0);settings_init();assert(settings_get().offset_centi==-30);
 v.offset_centi=501;assert(settings_save(v)==2);v.offset_centi=11;assert(settings_save(v)==2);
 v.offset_centi=50;fail=1;assert(settings_save(v)!=0);assert(settings_get().offset_centi==-30);fail=0;
 fail=1;assert(settings_reset()!=0);assert(settings_get().offset_centi==-30);fail=0;
 assert(settings_reset()==0);settings_init();
 aquarium_settings_t defaults=settings_get();
 assert(defaults.brightness==1&&defaults.sample_seconds==5&&defaults.report_seconds==60&&defaults.delta_centi==20&&defaults.offset_centi==0);
 // Non-default measurement settings and correction migrate without a theme key.
 int32_t previous[]={2,100,10,300,50,-20};memcpy(stored,previous,sizeof previous);length=sizeof previous;has_theme=0;
 settings_init();v=settings_get();assert(v.brightness==100&&v.offset_centi==-20&&v.theme==0);
 v.theme=3;assert(settings_save(v)==0);settings_init();assert(settings_get().theme==3);
 // A 0.7 reader still sees the exact schema-2 record it understands.
 assert(length==24&&((uint32_t*)stored)[0]==2&&((int32_t*)stored)[5]==-20);
 v.theme=4;assert(settings_save(v)==2);v.theme=-1;assert(settings_save(v)==2);v.theme=3;
 theme=99;settings_init();assert(settings_get().theme==0);theme=3;settings_init();assert(settings_get().theme==3);
 fail=1;assert(settings_reset()!=0);assert(settings_get().theme==3);fail=0;
 assert(settings_reset()==0);settings_init();assert(settings_get().theme==0);
 uint32_t future=3;memcpy(stored,&future,4);settings_init();assert(settings_save(v)==3);assert(settings_reset()==3);
 assert(memcmp(stored,&future,4)==0);
 return 0;
}
''')
            executable = p / 'test-settings'
            subprocess.run(['cc', '-std=c11', '-I'+str(p), '-I'+str(ROOT/'main'), str(ROOT/'main/settings.c'), str(p/'test.c'), '-o', str(executable)], check=True)
            subprocess.run([str(executable)], check=True)

if __name__ == '__main__':
    unittest.main()
