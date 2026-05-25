document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');
    const uploadPrompt = document.getElementById('uploadPrompt');
    const previewContainer = document.getElementById('previewContainer');
    const uploadPreview = document.getElementById('uploadPreview');
    const btnRemoveFile = document.getElementById('btnRemoveFile');
    
    const processForm = document.getElementById('processForm');
    const btnSubmit = document.getElementById('btnSubmit');
    const btnText = btnSubmit.querySelector('.btn-text');
    const spinner = btnSubmit.querySelector('.spinner');
    
    const removeVisible = document.getElementById('removeVisible');
    const visibleDetails = document.getElementById('visibleDetails');
    const visibleStrength = document.getElementById('visibleStrength');
    const visibleStrengthVal = document.getElementById('visibleStrengthVal');
    
    const removeInvisible = document.getElementById('removeInvisible');
    const invisibleDetails = document.getElementById('invisibleDetails');
    const invisibleStrength = document.getElementById('invisibleStrength');
    const invisibleStrengthVal = document.getElementById('invisibleStrengthVal');
    
    const humanize = document.getElementById('humanize');
    const humanizeVal = document.getElementById('humanizeVal');
    
    const sliderWrapper = document.getElementById('sliderWrapper');
    const afterImgContainer = document.getElementById('afterImgContainer');
    const imgAfter = document.getElementById('imgAfter');
    const sliderHandle = document.getElementById('sliderHandle');
    const imgBefore = document.getElementById('imgBefore');
    
    const btnDownload = document.getElementById('btnDownload');
    const consoleBody = document.getElementById('consoleBody');
    const btnClearConsole = document.getElementById('btnClearConsole');

    let isProcessing = false;
    let uploadedFile = null;

    /* ==========================================================================
       1. TERMINAL LOGGER
       ========================================================================== */
    function addLog(message, type = 'info') {
        const row = document.createElement('div');
        row.className = `log-row ${type}`;
        row.textContent = `> ${message}`;
        consoleBody.appendChild(row);
        consoleBody.scrollTop = consoleBody.scrollHeight;
    }

    btnClearConsole.addEventListener('click', () => {
        consoleBody.innerHTML = '';
        addLog('콘솔 로그가 지워졌습니다.', 'info');
    });

    /* ==========================================================================
       2. DYNAMIC FORM INTERACTIONS
       ========================================================================== */
    // Toggle Visible Options
    removeVisible.addEventListener('change', (e) => {
        visibleDetails.style.display = e.target.checked ? 'block' : 'none';
        addLog(`가시적 워터마크 소거 모드: ${e.target.checked ? '활성화' : '비활성화'}`, 'info');
    });

    // Toggle Invisible Options
    removeInvisible.addEventListener('change', (e) => {
        invisibleDetails.style.display = e.target.checked ? 'block' : 'none';
        addLog(`비가시적 워터마크(SynthID) 제거 모드: ${e.target.checked ? '활성화' : '비활성화'}`, 'info');
    });

    // Range Sliders Event Listeners
    visibleStrength.addEventListener('input', (e) => {
        visibleStrengthVal.textContent = `${Math.round(e.target.value * 100)}%`;
    });

    invisibleStrength.addEventListener('input', (e) => {
        invisibleStrengthVal.textContent = `${Math.round(e.target.value * 100)}%`;
    });

    humanize.addEventListener('input', (e) => {
        humanizeVal.textContent = `${Math.round(e.target.value * 100)}%`;
    });

    /* ==========================================================================
       3. DRAG AND DROP FILE UPLOAD
       ========================================================================== */
    // Click dropzone to select file
    dropzone.addEventListener('click', (e) => {
        if (e.target !== btnRemoveFile && !btnRemoveFile.contains(e.target)) {
            fileInput.click();
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFile(e.target.files[0]);
        }
    });

    // Drag events
    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.add('dragover');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.remove('dragover');
        }, false);
    });

    dropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            handleFile(files[0]);
        }
    });

    function handleFile(file) {
        if (!file.type.startsWith('image/')) {
            addLog('올바른 이미지 파일 형식이 아닙니다.', 'error');
            return;
        }
        
        uploadedFile = file;
        
        // Show preview
        const reader = new FileReader();
        reader.onload = (e) => {
            uploadPreview.src = e.target.result;
            uploadPrompt.style.display = 'none';
            previewContainer.style.display = 'flex';
            
            // Set canvas before image source to uploaded image
            imgBefore.src = e.target.result;
            
            // Enable button
            btnSubmit.disabled = false;
            addLog(`이미지 탑재 완료: ${file.name} (${Math.round(file.size / 1024)} KB)`, 'success');
        };
        reader.readAsDataURL(file);
    }

    btnRemoveFile.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.value = '';
        uploadedFile = null;
        uploadPreview.src = '';
        previewContainer.style.display = 'none';
        uploadPrompt.style.display = 'block';
        btnSubmit.disabled = true;
        
        // Reset Before image
        imgBefore.src = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1000&q=80';
        addLog('업로드된 이미지가 제거되었습니다.', 'info');
    });

    /* ==========================================================================
       4. BEFORE / AFTER INTERACTIVE DRAG SLIDER
       ========================================================================== */
    let sliderActive = false;

    function moveSlider(x) {
        const rect = sliderWrapper.getBoundingClientRect();
        let position = ((x - rect.left) / rect.width) * 100;
        
        // Boundaries clamp
        if (position < 0) position = 0;
        if (position > 100) position = 100;

        // Apply styles
        afterImgContainer.style.width = `${position}%`;
        sliderHandle.style.left = `${position}%`;
    }

    // Touch and mouse events
    const startSliderMove = (e) => {
        sliderActive = true;
        e.preventDefault();
    };

    const stopSliderMove = () => {
        sliderActive = false;
    };

    const handleSliderMove = (e) => {
        if (!sliderActive) return;
        
        let clientX;
        if (e.type === 'touchmove') {
            clientX = e.touches[0].clientX;
        } else {
            clientX = e.clientX;
        }
        
        moveSlider(clientX);
    };

    // Event listeners for dragging
    sliderHandle.addEventListener('mousedown', startSliderMove);
    window.addEventListener('mouseup', stopSliderMove);
    window.addEventListener('mousemove', handleSliderMove);

    sliderHandle.addEventListener('touchstart', startSliderMove);
    window.addEventListener('touchend', stopSliderMove);
    window.addEventListener('touchmove', handleSliderMove);

    // Click anywhere on the slider to jump
    sliderWrapper.addEventListener('click', (e) => {
        if (e.target !== sliderHandle && !sliderHandle.contains(e.target)) {
            moveSlider(e.clientX);
        }
    });

    // Make sure the clipped image width matches the container width on window resize
    window.addEventListener('resize', () => {
        const rect = sliderWrapper.getBoundingClientRect();
        imgAfter.style.width = `${rect.width}px`;
    });

    // Initialize layout width on load
    imgBefore.addEventListener('load', () => {
        const rect = sliderWrapper.getBoundingClientRect();
        imgAfter.style.width = `${rect.width}px`;
    });

    /* ==========================================================================
       5. ASYNC PROCESS SUBMIT VIA FETCH API
       ========================================================================== */
    processForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (isProcessing || !uploadedFile) return;

        isProcessing = true;
        btnSubmit.disabled = true;
        spinner.style.display = 'block';
        btnText.innerHTML = '워터마크 소거 중...';
        
        addLog('🚀 [프로세스 개시] 백엔드 엔진 요청을 시작합니다.', 'info');

        const formData = new FormData();
        formData.append('file', uploadedFile);
        formData.append('remove_visible', removeVisible.checked);
        formData.append('remove_metadata', removeMetadata.checked);
        formData.append('remove_invisible', removeInvisible.checked);
        formData.append('visible_strength', parseFloat(visibleStrength.value));
        formData.append('invisible_strength', parseFloat(invisibleStrength.value));
        formData.append('protect_faces', processForm.elements['protect_faces']?.checked || false);
        formData.append('humanize', parseFloat(humanize.value));

        try {
            const response = await fetch('/process', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.detail || '알 수 없는 서버 에러 발생');
            }

            const data = await response.json();
            
            if (data.success) {
                // 1. Print Server logs
                data.logs.forEach(log => {
                    if (log.includes('✅') || log.includes('🎉') || log.includes('성공')) {
                        addLog(log, 'success');
                    } else if (log.includes('⚠️') || log.includes('ℹ️')) {
                        addLog(log, 'warning');
                    } else if (log.includes('❌')) {
                        addLog(log, 'error');
                    } else {
                        addLog(log, 'info');
                    }
                });

                // 2. Refresh Before / After Canvas Images
                // Cache busting parameter added to prevent browser using cached old result
                const cacheBust = `?t=${new Date().getTime()}`;
                imgBefore.src = data.input_url + cacheBust;
                imgAfter.src = data.output_url + cacheBust;

                // Set Download Button
                btnDownload.href = data.output_url;
                btnDownload.classList.remove('disabled');

                // Adjust sliding width
                setTimeout(() => {
                    const rect = sliderWrapper.getBoundingClientRect();
                    imgAfter.style.width = `${rect.width}px`;
                    // Reset slider handle to 50%
                    afterImgContainer.style.width = '50%';
                    sliderHandle.style.left = '50%';
                }, 200);

            } else {
                addLog(`처리 실패: ${data.error}`, 'error');
            }

        } catch (error) {
            console.error(error);
            addLog(`❌ 엔진 오류 발생: ${error.message}`, 'error');
        } finally {
            isProcessing = false;
            btnSubmit.disabled = false;
            spinner.style.display = 'none';
            btnText.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> 복원 프로세스 시작';
        }
    });
});
