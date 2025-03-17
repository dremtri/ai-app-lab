// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// Licensed under the 【火山方舟】原型应用软件自用许可协议
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at 
//     https://www.volcengine.com/docs/82379/1433703
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License. 

import { useContext, useEffect } from 'react';
import { AudioChatServiceContext } from '@/components/AudioChatServiceProvider/context';
import { Message } from '@arco-design/web-react';
import { useAudioChatState } from '@/components/AudioChatProvider/hooks/useAudioChatState';
import { useLogContent } from '@/components/AudioChatServiceProvider/hooks/useLogContent';
import { useAudioRecorder } from '@/components/AudioChatServiceProvider/hooks/useAudioRecorder';
import VoiceBotService from 'lvc-sdk';
import { EventType } from '@/types';
import { useSpeakerConfig } from '@/components/AudioChatServiceProvider/hooks/useSpeakerConfig';
import { useMessageList } from '@/components/AudioChatProvider/hooks/useMessageList';
import { useSyncRef } from '@/hooks/useSyncRef';
import { useWsUrl } from '@/components/AudioChatServiceProvider/hooks/useWsUrl';

export const useVoiceBotService = () => {
  const {
    wsReadyRef,
    setCurrentUserSentence,
    setCurrentBotSentence,
    serviceRef,
    waveRef,
    configNeedUpdateRef,
  } = useContext(AudioChatServiceContext);
  const { recStart, recStop } = useAudioRecorder();
  const { currentSpeaker } = useSpeakerConfig();
  const currentSpeakerRef = useSyncRef(currentSpeaker);

  const { setChatMessages } = useMessageList();
  const { setWsConnected, setBotSpeaking, setBotAudioPlaying, isCallingRef } =
    useAudioChatState();

  const { wsUrl } = useWsUrl();

  const { log } = useLogContent();
  const handleBotUpdateConfig = () => {
    if (!serviceRef.current) {
      return;
    }
    serviceRef.current.sendMessage({
      event: EventType.BotUpdateConfig,
      payload: {
        speaker: currentSpeakerRef.current,
      },
    });
    log(
      'send | event:' +
        EventType.UserAudio +
        ' payload: ' +
        JSON.stringify({
          speaker: currentSpeaker,
        }),
    );
  };

  const handleConnect = async () => {
    setTimeout(() => {
      if (!serviceRef.current) {
        return;
      }
      serviceRef.current
        .connect()
        .then(() => {
          setWsConnected(true);
          log('connect success');
        })
        .catch(e => {
          log('connect failed');
          Message.error('连接失败');
          setWsConnected(false);
        });
    }, 0);
  };

  useEffect(() => {
    serviceRef.current = new VoiceBotService({
      ws_url: wsUrl,
      onStartPlayAudio: data => {
        setBotAudioPlaying(true);
        serviceRef.current?.startVisualization((data) => {
          const pcmData = new Int16Array(data.length);
          // 将 8 位无符号数据转换为 16 位有符号
          for (let i = 0; i < data.length; i++) {
            const normalized = (data[i] - 128) / 128;  // 转换为 -1 到 1 的浮点数
            pcmData[i] = Math.max(-32768, Math.min(32767, normalized * 32768)); // 16 位有符号
          }
          waveRef.current && waveRef.current.input(pcmData, 0, 16000);
        })
      },
      onStopPlayAudio: () => {
        serviceRef.current?.stopVisualization();
        setBotAudioPlaying(false);
        setCurrentUserSentence('');
        setCurrentBotSentence('');
        if (!wsReadyRef.current) {
          return;
        }
        if (isCallingRef.current) {
          recStart();
        }
      },
      handleJSONMessage: msg => {
        const { event, payload } = msg;
        log('receive | event:' + event + ' payload:' + JSON.stringify(payload));
        switch (event) {
          case EventType.BotReady:
            wsReadyRef.current = true;
            break;
          case EventType.SentenceRecognized:
            setCurrentUserSentence(prevSentence => {
              const content = prevSentence + payload?.sentence || '';
              return content
            })
            setChatMessages(prev => {
              const len = prev.length
              const lastIndex = len - 1
              if (lastIndex === -1 || prev[lastIndex].role === 'bot') {
                prev.push({ role: 'user', content: payload?.sentence || '' })
              } else {
                prev[lastIndex].content += payload?.sentence || ''
              }
              return prev
            });
            break;
          case EventType.SentenceRecognizedDone:
            recStop();
            setCurrentUserSentence(() => {
              const content = payload?.sentence || '';
              return content
            });
            setChatMessages(prev => {
              const content = payload?.sentence || ''
              const len = prev.length
              const lastIndex = len - 1
              if (lastIndex === -1 || prev[lastIndex].role === 'bot') {
                prev.push({ role: 'user', content })
              } else {
                prev[lastIndex].content = content
              }
              return prev
            });
            break;
          case EventType.LLMResponse:
            setCurrentBotSentence(prevSentence => {
              const content = prevSentence + payload?.sentence || '';
              return content
            })
            setChatMessages(prev => {
              const len = prev.length
              const lastIndex = len - 1
              if (lastIndex === -1 || prev[lastIndex].role === 'user') {
                prev.push({ role: 'bot', content: payload?.sentence || '' })
              } else {
                prev[lastIndex].content += payload?.sentence || ''
              }
              return prev
            });
            setBotSpeaking(true);
            break;
          case EventType.LLMResponseDone:
            setBotSpeaking(false);
            break;
          case EventType.ResponseDone:
            // if (configNeedUpdateRef.current) {
            //   handleBotUpdateConfig();
            //   configNeedUpdateRef.current = false;
            // }
        }
      },
    });
  }, [wsUrl]);

  return {
    handleConnect,
  };
};
