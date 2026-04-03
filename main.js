// ==UserScript==
// @name         超星学习通AI自动答题
// @namespace    http://tampermonkey.net/
// @icon         http://pan-yz.chaoxing.com/favicon.ico
// @version      1.0.2
// @description  在学习通页面注入悬浮窗，通过配置OpenAI格式的API实现对单选、多选、填空、简答等题型的自动识别与作答。注：此脚本遵循 APL 2.0 开源协议，完全免费
// @author       Black Cyan
// @license      APL 2.0
// @homepageURL  https://github.com/Black-Cyan/chaoxing
// @match        *://*.chaoxing.com/*
// @match        *://*.edu.cn/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      *
// ==/UserScript==

(function () {
    'use strict';

    // 默认配置
    const DEFAULT_CONFIG = {
        apiUrl: 'https://api.openai.com/v1/chat/completions',
        apiKey: '',
        model: 'gpt-3.5-turbo',
        autoAnswer: false
    };

    let config = {
        apiUrl: GM_getValue('apiUrl', DEFAULT_CONFIG.apiUrl),
        apiKey: GM_getValue('apiKey', DEFAULT_CONFIG.apiKey),
        model: GM_getValue('model', DEFAULT_CONFIG.model),
        autoAnswer: GM_getValue('autoAnswer', DEFAULT_CONFIG.autoAnswer)
    };

    // 注入CSS
    GM_addStyle(`
        #ai-helper-panel {
            position: fixed; top: 100px; right: 20px; width: 300px;
            background: #fff; border: 1px solid #ccc; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 999999; font-family: sans-serif; border-radius: 8px; overflow: hidden;
        }
        #ai-helper-header {
            background: #4caf50; color: white; padding: 10px; cursor: move; font-weight: bold;
            display: flex; justify-content: space-between; align-items: center;
        }
        #ai-helper-body { padding: 15px; }
        .ai-form-group { margin-bottom: 10px; }
        .ai-form-group label { display: block; font-size: 13px; margin-bottom: 4px; color: #333; }
        .ai-form-group input[type="text"], .ai-form-group input[type="password"] {
            width: 100%; padding: 6px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px;
        }
        .ai-form-group input[type="checkbox"] { margin-right: 5px; }
        .ai-btn {
            background: #4caf50; color: white; border: none; padding: 8px 12px; width: 100%;
            border-radius: 4px; cursor: pointer; font-size: 14px; margin-top: 10px;
        }
        .ai-btn:hover { background: #45a049; }
        #ai-status { margin-top: 10px; font-size: 12px; color: #666; word-break: break-all; }
        #ai-logs { max-height: 120px; overflow-y: auto; font-size: 12px; margin-top: 10px; background: #f9f9f9; border: 1px solid #ddd; padding: 5px; border-radius: 4px; word-break: break-all;}
        .ai-log-item { margin-bottom: 4px; border-bottom: 1px dashed #eee; padding-bottom: 2px; }
    `);

    // ==========================================
    // UI 面板渲染与事件绑定
    // ==========================================
    
    // 创建交互面板
    function createUI() {
        if (document.getElementById('ai-helper-panel')) return;

        const panel = document.createElement('div');
        panel.id = 'ai-helper-panel';
        panel.innerHTML = `
            <div id="ai-helper-header">
                <span>AI 答题控制中心</span>
                <span id="ai-helper-toggle" style="cursor:pointer; font-size: 12px;">[-]</span>
            </div>
            <div id="ai-helper-body">
                <div class="ai-form-group">
                    <label>API URL:</label>
                    <input type="text" id="ai-api-url" value="${config.apiUrl}">
                </div>
                <div class="ai-form-group">
                    <label>API Key:</label>
                    <input type="password" id="ai-api-key" value="${config.apiKey}" placeholder="sk-...">
                </div>
                <div class="ai-form-group">
                    <label>模型 (Model):</label>
                    <input type="text" id="ai-model" value="${config.model}">
                </div>
                <div class="ai-form-group" style="display:flex; align-items:center;">
                    <input type="checkbox" id="ai-auto-answer" ${config.autoAnswer ? 'checked' : ''}>
                    <label style="margin:0; cursor:pointer;" for="ai-auto-answer">开启自动答题</label>
                </div>
                <button class="ai-btn" id="ai-save-btn">保存配置</button>
                <button class="ai-btn" id="ai-run-btn" style="background:#2196f3;">当前页面手动触发</button>
                <div id="ai-status">状态：就绪</div>
                <div id="ai-logs"></div>
            </div>
        `;
        document.body.appendChild(panel);
        bindUIEvents(panel);
    }

    // 绑定 UI 面板的基础操作
    function bindUIEvents(panel) {
        const header = document.getElementById('ai-helper-header');
        const body = document.getElementById('ai-helper-body');
        const toggleBtn = document.getElementById('ai-helper-toggle');
        const saveBtn = document.getElementById('ai-save-btn');
        const runBtn = document.getElementById('ai-run-btn');

        // 拖拽逻辑
        let isDragging = false, startX, startY, initialX, initialY;
        header.addEventListener('mousedown', function (e) {
            if (e.target.id === 'ai-helper-toggle') return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            initialX = panel.offsetLeft;
            initialY = panel.offsetTop;
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        function onMouseMove(e) {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            panel.style.left = initialX + dx + 'px';
            panel.style.top = initialY + dy + 'px';
            panel.style.right = 'auto'; // 覆盖原有的right属性
        }

        function onMouseUp() {
            isDragging = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }

        // 折叠逻辑
        toggleBtn.addEventListener('click', () => {
            if (body.style.display === 'none') {
                body.style.display = 'block';
                toggleBtn.innerText = '[-]';
            } else {
                body.style.display = 'none';
                toggleBtn.innerText = '[+]';
            }
        });

        // 保存配置
        saveBtn.addEventListener('click', () => {
            config.apiUrl = document.getElementById('ai-api-url').value;
            config.apiKey = document.getElementById('ai-api-key').value;
            config.model = document.getElementById('ai-model').value;
            config.autoAnswer = document.getElementById('ai-auto-answer').checked;

            GM_setValue('apiUrl', config.apiUrl);
            GM_setValue('apiKey', config.apiKey);
            GM_setValue('model', config.model);
            GM_setValue('autoAnswer', config.autoAnswer);

            updateStatus('配置已保存！', 'green');
        });

        // 手动触发
        runBtn.addEventListener('click', () => {
            startAnswering();
        });
    }

    // ==========================================
    // 状态记录与日志输出
    // ==========================================
    
    // 更新悬浮窗顶部状态栏的文字与颜色
    function updateStatus(text, color = '#666') {
        const statusDiv = document.getElementById('ai-status');
        if (statusDiv) {
            statusDiv.innerText = `状态：${text}`;
            statusDiv.style.color = color;
        }
        addLog(text, color);
    }

    // 往悬浮窗底部的日志框内压入历史记录
    function addLog(text, color = '#333') {
        const logsDiv = document.getElementById('ai-logs');
        if (logsDiv) {
            const item = document.createElement('div');
            item.className = 'ai-log-item';
            item.style.color = color;
            item.innerText = `[${new Date().toLocaleTimeString('it-IT')}] ${text}`;
            logsDiv.appendChild(item);
            logsDiv.scrollTop = logsDiv.scrollHeight; // 自动滚动到底部
        }
        console.log(`[AI答题日志] ${text}`);
    }

    // ==========================================
    // 大模型 API 交互模块
    // ==========================================
    
    // 对接 OpenAI 标准接口，处理 HTTP 通信与数据解析
    function askAI(prompt) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: config.apiUrl,
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${config.apiKey}`
                },
                data: JSON.stringify({
                    model: config.model,
                    messages: [
                        { role: "system", content: "你现在是一个没有感情的自动答题发稿机器。你的任务是根据提供的题目类型、题干和选项（如果有），直接且仅输出用户所需的最终作答结果。你必须严格遵守以下红线：\n1. 绝对不要输出任何解析、问候语、确认语或诸如'答案是'、'正确选项是'等引导性文字。\n2. 单选题或判断题：仅输出一个选项字母（如 A）；如果是判断（对/错），转化为对应语义的字母或直接输出“对”“错”。\n3. 多选题：仅输出正确选项字母的组合，按字母顺序排列（如 ABC），不要加逗号或空格。\n4. 填空题：必须且只能按顺序给出所有空的答案，多个空之间严格仅使用竖线 `|` 分隔（例如：苹果|香蕉|橘子）。如果你只识别出1个空，直接输出内容即可。\n5. 简答题/名词解释：仅输出精炼准确的核心解答内容，不带任何废话。\n如果违反以上任何一条规则，都会导致评阅系统崩溃。请开始答题。" },
                        { role: "user", content: prompt }
                    ],
                    temperature: 0.1
                }),
                onload: function(res) {
                    if (res.status !== 200) {
                        reject(`请求失败 (HTTP ${res.status}): ${res.responseText.substring(0, 100)}...`);
                        return;
                    }
                    try {
                        // 尝试以普通 JSON 解析
                        let data;
                        try {
                            data = JSON.parse(res.responseText);
                            if (data.choices && data.choices.length > 0) {
                                resolve(data.choices[0].message.content.trim());
                                return;
                            }
                        } catch (e) {
                            // 可能是 Stream 格式 (SSE)
                            let combinedContent = "";
                            const lines = res.responseText.split('\n');
                            for (const line of lines) {
                                const trimmedLine = line.trim();
                                if (trimmedLine.startsWith('data:')) {
                                    const jsonStr = trimmedLine.substring(5).trim();
                                    if (jsonStr === '[DONE]') continue;
                                    if (jsonStr) {
                                        try {
                                            const chunk = JSON.parse(jsonStr);
                                            if (chunk.choices && chunk.choices[0].delta && chunk.choices[0].delta.content) {
                                                combinedContent += chunk.choices[0].delta.content;
                                            }
                                        } catch (err) {
                                            // 忽略无法解析的流数据行
                                        }
                                    }
                                }
                            }
                            if (combinedContent) {
                                resolve(combinedContent.trim());
                                return;
                            }
                        }
                        
                        if (data && data.error) {
                            reject('API返回错误: ' + data.error.message);
                        } else {
                            reject('API响应格式无结果或无法解析为标准/流格式: ' + res.responseText.substring(0, 100));
                        }
                    } catch (e) {
                        console.error('API返回原始内容:', res.responseText);
                        reject('JSON解析错误: ' + e.message + ' (请检查API URL是否正确)');
                    }
                },
                onerror: function(err) {
                    reject('网络请求失败');
                }
            });
        });
    }

    // ==========================================
    // 核心自动答题业务逻辑
    // ==========================================
    
    // 解析 DOM 寻找题目节点，构造 Prompt 并调用大模型完成答题流转
    async function startAnswering() {
        if (!config.apiKey) {
            updateStatus('请先配置API Key', 'red');
            return;
        }

        updateStatus('开始解析页面题目...', 'blue');
        
        let questions = document.querySelectorAll('.questionLi');
        if (questions.length === 0) {
            questions = document.querySelectorAll('.TiMu'); // 兼容老版本
        }
        
        if (questions.length === 0) {
            updateStatus('页面上没有发现目标题目，请确认是否处于答题页面。', 'red');
            return;
        }

        for (let i = 0; i < questions.length; i++) {
            const qNode = questions[i];
            updateStatus(`正在作答第 ${i + 1}/${questions.length} 题...`, 'blue');

            // 提取题干
            const titleNode = qNode.querySelector('.mark_name') || qNode.querySelector('.Zy_TItle .clearfix') || qNode.querySelector('.Zy_TItle');
            const titleText = titleNode ? titleNode.innerText.replace(/[\r\n]+/g, ' ').trim() : '';
            
            // 提取题型描述
            let typeText = qNode.getAttribute('typeName');
            if (!typeText) {
                const typeNode = qNode.querySelector('.colorShallow') || qNode.querySelector('.Zy_TItle .clearfix i') || qNode.querySelector('div.Zy_TItle > i');
                typeText = typeNode ? typeNode.innerText.trim() : '未知题型';
            }

            // 提取选项
            const optionNodes = qNode.querySelectorAll('ul.Zy_ulTop li, .answerBg');
            let optionsText = '';
            optionNodes.forEach(opt => {
                optionsText += opt.innerText.trim() + '\n';
            });

            // 判断是否已作答
            let isAnswered = false;
            if (typeText.includes('单选') || typeText.includes('多选') || typeText.includes('判断')) {
                const checkedInputs = qNode.querySelectorAll('input[type="radio"]:checked, input[type="checkbox"]:checked');
                // 新版学习通有些选项可能是通过给外层 div 加特定 class 来表示选中
                const checkedBgs = qNode.querySelectorAll('.answerBg.check_answer_bg, .check_answer');
                if (checkedInputs.length > 0 || checkedBgs.length > 0) {
                    isAnswered = true;
                }
            } else if (typeText.includes('填空')) {
                const answers = qNode.querySelectorAll('.Answer');
                const inputs = qNode.querySelectorAll('.ui-input-text input, input[type="text"]');
                if (answers.length > 0) {
                    // 检查 UEditor / textarea 是否有值
                    answers.forEach(ans => {
                        const textarea = ans.querySelector('textarea');
                        const iframe = ans.querySelector('iframe');
                        if (textarea && textarea.value.trim() !== '') {
                            isAnswered = true;
                        } else if (iframe && iframe.contentWindow && iframe.contentWindow.document) {
                            const body = iframe.contentWindow.document.querySelector('body');
                            if (body && body.innerText.trim() !== '') {
                                isAnswered = true;
                            }
                        }
                    });
                } else if (inputs.length > 0) {
                    inputs.forEach(input => {
                        if (input.value.trim() !== '') isAnswered = true;
                    });
                }
            } else if (typeText.includes('简答') || typeText.includes('名词解释')) {
                const textarea = qNode.querySelector('textarea');
                const iframe = qNode.querySelector('iframe');
                if (textarea && textarea.value.trim() !== '') {
                    isAnswered = true;
                } else if (iframe && iframe.contentWindow && iframe.contentWindow.document) {
                    const body = iframe.contentWindow.document.querySelector('body');
                    if (body && body.innerText.trim() !== '') {
                        isAnswered = true;
                    }
                }
            }

            if (isAnswered) {
                addLog(`第 ${i + 1} 题已作答，跳过该题`, '#888');
                continue; // 跳过当前循环，不向API发送请求
            }

            // 题型解构规则定制
            let specificInstruction = "";
            let inputCount = 0;
            if (typeText.includes('单选') || typeText.includes('单项选择')) {
                specificInstruction = "当前为【单选题】。请仅提供一个正确选项的字母（例如：A）。绝不允许有任何多余字符。";
            } else if (typeText.includes('多选') || typeText.includes('多项选择')) {
                specificInstruction = "当前为【多选题】。请仅提供正确选项字母的组合，中间不得有空格（例如：ABC）。绝不允许有任何多余字符。";
            } else if (typeText.includes('判断')) {
                specificInstruction = "当前为【判断题】。请仅从“对”、“错”或者对应的字母（如“A”、“B”）中选择并在结果中返回，绝不要有附加说明。";
            } else if (typeText.includes('填空')) {
                let blankCount = qNode.querySelectorAll('.Answer').length;
                if (blankCount === 0) {
                    blankCount = qNode.querySelectorAll('.ui-input-text input, input[type="text"]').length;
                }
                specificInstruction = `当前为【填空题】，本题共有 ${blankCount} 个空位。\n你需要给出每个空的答案。\n注意核心要求：多个空的答案之间必须严格使用一根竖线（|）作为分隔符（例如：正确答案1|正确答案2|正确答案3）。仅1个空时，直接给出该内容即可，不可带竖线。不得增加任何引言或解释！`;
            } else if (typeText.includes('简答') || typeText.includes('名词解释')) {
                specificInstruction = "当前为【主观题（简答/名词解释）】。请直接给出精炼的解答正文，不需任何废话或前缀。";
            } else {
                specificInstruction = "请直接给出答案。客观题直接给字母或对错，主观题直接给内容正文，不附带解析。";
            }

            const prompt = `--- 题目开始 ---\n【类型】：${typeText}\n【题干】：${titleText}\n${optionsText ? '【选项】：\n' + optionsText : ''}--- 题目结束 ---\n\n【最高指令】：${specificInstruction}`;

            try {
                const answer = await askAI(prompt);
                addLog(`第 ${i+1} 题大模型返回: ${answer}`, 'green');
                
                // 执行答案勾选/填入
                fillAnswer(qNode, typeText, answer);

                // 避免并发过快，随机延时 1-3 秒
                await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
            } catch (err) {
                console.error('答题出错:', err);
                updateStatus(`第 ${i + 1} 题作答失败：${err}`, 'red');
            }
        }

        updateStatus('当前页面答题完成！', 'green');
    }

    // ==========================================
    // 模拟答题填报器
    // ==========================================
    
    // 根据题型把 AI 给出结果的回推入对应 DOM 的 Input/Textarea/Radio 中去
    function fillAnswer(qNode, qType, aiAnswer) {
        if (!qType) return;
        
        if (qType.includes('单选') || qType.includes('多选') || qType.includes('判断')) {
            const options = qNode.querySelectorAll('ul.Zy_ulTop li, .answerBg');
            const answerChars = aiAnswer.toUpperCase().split(''); // 比如 "ABC" -> ['A','B','C']
            
            options.forEach(opt => {
                const optIdentifier = opt.querySelector('i.fl') || opt.querySelector('.fl') || opt.querySelector('.mark_letter'); 
                const text = optIdentifier ? optIdentifier.innerText.trim().replace(/[^a-zA-Z]/g, '') : ''; // 提取字母 "A"
                if (text && answerChars.includes(text.charAt(0))) {
                    const input = opt.querySelector('input[type="radio"], input[type="checkbox"]');
                    if (input && !input.checked) {
                        input.click();
                    } else if (!input) {
                        const checkBg = opt.querySelector('.check_answer') || opt;
                        if (checkBg) checkBg.click();
                    }
                }
            });
        }
        else if (qType.includes('填空')) {
            const parts = aiAnswer.split('|'); // 假设AI按约定用|隔开了多个空
            
            // 模式一：旧版文本框输入 或 特定单空填空
            const inputs = qNode.querySelectorAll('.ui-input-text input, input[type="text"]');
            if (inputs.length > 0) {
                inputs.forEach((input, idx) => {
                    if (parts[idx]) {
                        input.value = parts[idx].trim();
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                });
            }
            
            // 模式二：新版通过 UEditor 富文本/iframe 或 textarea 形式提交填空题
            const answers = qNode.querySelectorAll('.Answer');
            if (answers.length > 0) {
                answers.forEach((ans, idx) => {
                    if (parts[idx]) {
                        // 尝试对原生的 textarea 赋值
                        const textarea = ans.querySelector('textarea');
                        if (textarea) {
                            textarea.value = parts[idx].trim();
                            textarea.dispatchEvent(new Event('input', { bubbles: true }));
                        }
                        
                        // 尝试向 UEditor Iframe 的 body 内注入文本
                        const iframe = ans.querySelector('iframe');
                        if (iframe && iframe.contentWindow && iframe.contentWindow.document) {
                            const body = iframe.contentWindow.document.querySelector('body');
                            if (body) {
                                body.innerText = parts[idx].trim();
                            }
                        }
                    }
                });
            }
        }
        else if (qType.includes('简答') || qType.includes('名词解释') || qType.includes('论述')) {
            // 一般会有个富文本编辑器iframe，同时带有一个被隐藏的textarea用于最终提交
            try {
                // 尝试查找和修改UEditor iframe的内容
                const iframe = qNode.querySelector('iframe');
                if (iframe && iframe.contentWindow && iframe.contentWindow.document) {
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                    const body = iframeDoc.querySelector('body');
                    if (body) {
                        body.innerHTML = '<p>' + aiAnswer + '</p>';
                        body.dispatchEvent(new Event('blur', { bubbles: true })); // 触发某些绑定的保存事件
                        body.dispatchEvent(new Event('keyup', { bubbles: true }));
                    }
                }
                
                // 尝试向同节点的 textarea 同步
                const textarea = qNode.querySelector('textarea');
                if (textarea) {
                    textarea.value = aiAnswer;
                    textarea.innerHTML = aiAnswer;
                    // React/Vue或内部原生事件模拟
                    textarea.dispatchEvent(new Event('input', { bubbles: true }));
                    textarea.dispatchEvent(new Event('change', { bubbles: true }));
                    textarea.dispatchEvent(new Event('blur', { bubbles: true }));
                }
            } catch (err) {
                console.error('简答题填入异常:', err);
            }
        }
    }

    // ==========================================
    // 脚本启动器入口
    // ==========================================
    
    // 初始化脚本探测器，检查执行环境并在合适的上下文里挂载控制器或静默
    function init() {
        // 只在包含题目节点的页面注入悬浮窗并自动答题
        // 如果页面还未完全加载完毕，稍后再次检查
        if (!document.body) {
            setTimeout(init, 100);
            return;
        }

        // 检测当前页面是否包含“您的答案”、“正确答案”、“得分”之类的批阅标记，
        // 比如 class 为 mark_answer (作答结果), mark_score (得分), resultNum (总分)
        const isResultPage = document.querySelector('.mark_answer') || 
                             document.querySelector('.mark_score') || 
                             document.querySelector('.resultNum');
        if (isResultPage) {
            console.log("[学习通自动化] 发现批改/答案详情节点，当前为结果页，停止挂载自动答题脚本。");
            return;
        }
        
        // 延时检测页面中是否有做题区域，如果没有，就不注入整个悬浮窗脚本和相关逻辑
        // 我们给页面充分的加载时间，并尝试进行多次探测
        let checkCount = 0;
        const checkInterval = setInterval(() => {
            let questions = document.querySelectorAll('.questionLi');
            if (questions.length === 0) {
                questions = document.querySelectorAll('.TiMu');
            }
            
            if (questions.length > 0) {
                clearInterval(checkInterval);
                createUI();
                if (config.autoAnswer) {
                    setTimeout(startAnswering, 1000); 
                }
            } else {
                checkCount++;
                if (checkCount > 10) { // 探测大概 5 秒后放弃
                    clearInterval(checkInterval);
                    console.log("[学习通自动化] 未检测到题目，该页面不是答题页，悬浮窗不生效。");
                }
            }
        }, 500);
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        init();
    } else {
        window.addEventListener('DOMContentLoaded', init);
        window.addEventListener('load', init); // 作为兜底
    }

})();
