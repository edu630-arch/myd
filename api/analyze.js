/**
 * ==============================================================================
 * [Vercel Serverless Function: /api/analyze]
 * Google Gemini 생성형 AI API를 호출하여 일기 내용을 분석하고,
 * 대표 감정(이모지, 감정명)과 맞춤형 따뜻한 위로/응원 메시지를 반환합니다.
 * ==============================================================================
 */

module.exports = async function handler(req, res) {
  // CORS 및 메서드 허용 헤더 설정
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // OPTIONS 요청(프리플라이트) 처리
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // POST 요청만 허용
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST 메서드만 지원합니다.' });
  }

  try {
    // 1. 요청 본문(body)에서 일기 텍스트 추출
    let bodyData = req.body;
    if (typeof bodyData === 'string') {
      try {
        bodyData = JSON.parse(bodyData);
      } catch (e) {
        bodyData = {};
      }
    }

    const diaryContent = bodyData && bodyData.content ? bodyData.content.trim() : '';

    if (!diaryContent) {
      return res.status(400).json({ error: '일기 내용(content)이 비어 있습니다.' });
    }

    // 2. 환경 변수에서 Gemini API 키 가져오기
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ 
        error: '서버에 GEMINI_API_KEY 환경 변수가 설정되지 않았습니다. .env 파일이나 Vercel 환경 변수를 확인해주세요.' 
      });
    }

    // 3. Gemini AI 시스템 프롬프트 구성 (JSON 형식 강제)
    const systemPrompt = `
너는 일기를 읽고 사람들의 마음을 따뜻하게 안아주는 다정하고 지혜로운 AI 심리 상담사이자 친구야.
사용자가 작성한 일기를 깊이 있게 읽고, 사용자의 감정을 섬세하게 분석하여 반드시 유효한 JSON 형식으로만 응답해.

[응답 규칙]
1. emotionKey: "joy", "sadness", "anger", "tiredness", "peace", "love", "anxiety" 중 일기에 가장 잘 맞는 것 1개 선택
2. emotionName: 일기의 감정을 나타내는 한국어 표현 (예: "기쁨과 행복", "슬픔과 위로", "답답함과 분노", "피로와 지침", "평온과 여유", "사랑과 감사", "불안과 걱정")
3. emotionEmoji: 해당 감정에 가장 어울리는 단 하나의 이모지 (예: 😃, 😢, 😡, 🥱, 🌿, 💖, 😰)
4. aiMessage: 일기 내용 속 구체적인 사건과 마음에 깊이 공감하고, 진심 어린 위로와 다정한 응원을 건네는 2~3줄의 문장 (한국어 존댓말, 줄바꿈 포함)

[반드시 아래 JSON 포맷으로만 출력할 것 (마크다운 백틱 없이 순수 JSON만 반환)]:
{
  "emotionKey": "선택한키",
  "emotionName": "감정이름",
  "emotionEmoji": "이모지",
  "aiMessage": "2~3줄의 따뜻한 응원/위로 메시지"
}
`;

    const userPrompt = `사용자의 오늘 일기:\n"""\n${diaryContent}\n"""`;

    // 4. Google Gemini API 호출 (최신 gemini-3.6-flash 모델)
    const modelsToTry = ['gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-flash-latest'];
    let lastError = null;
    let geminiResult = null;

    for (const modelName of modelsToTry) {
      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

        const geminiResponse = await fetch(geminiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  { text: systemPrompt + '\n\n' + userPrompt }
                ]
              }
            ],
            generationConfig: {
              temperature: 0.7,
              responseMimeType: "application/json"
            }
          })
        });

        if (geminiResponse.ok) {
          geminiResult = await geminiResponse.json();
          break; // 성공 시 루프 종료
        } else {
          lastError = await geminiResponse.text();
        }
      } catch (err) {
        lastError = err.message;
      }
    }

    if (!geminiResult) {
      console.error('Gemini API 모든 모델 호출 실패:', lastError);
      return res.status(500).json({ 
        error: 'Gemini AI API 호출 중 오류가 발생했습니다.', 
        details: lastError 
      });
    }

    // 5. 응답 텍스트 추출 및 JSON 파싱
    const candidate = geminiResult.candidates && geminiResult.candidates[0];
    const rawText = candidate && candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text;

    if (!rawText) {
      throw new Error('Gemini API로부터 올바른 텍스트 응답을 받지 못했습니다.');
    }

    let cleanJsonText = rawText.trim();
    if (cleanJsonText.startsWith('```json')) {
      cleanJsonText = cleanJsonText.replace(/^```json/, '').replace(/```$/, '').trim();
    } else if (cleanJsonText.startsWith('```')) {
      cleanJsonText = cleanJsonText.replace(/^```/, '').replace(/```$/, '').trim();
    }

    const parsedData = JSON.parse(cleanJsonText);

    // 6. 클라이언트에 최종 결과 반환
    return res.status(200).json({
      success: true,
      emotionKey: parsedData.emotionKey || 'peace',
      emotionName: parsedData.emotionName || '평온함',
      emotionEmoji: parsedData.emotionEmoji || '🌿',
      aiMessage: parsedData.aiMessage || '오늘 하루도 정말 고생 많으셨어요. 편안한 밤 보내세요! 🍃'
    });

  } catch (error) {
    console.error('서버리스 함수 실행 오류:', error);
    return res.status(500).json({ 
      error: '일기 감정 분석 중 서버 내부 오류가 발생했습니다.',
      message: error.message 
    });
  }
};
