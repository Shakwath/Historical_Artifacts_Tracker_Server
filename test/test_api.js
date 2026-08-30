const http = require('http');

const PORT = 5000;
const BASE_URL = `http://localhost:${PORT}`;

// Helper function to send requests
function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const options = {
      hostname: 'localhost',
      port: PORT,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    if (body) {
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        let parsed = data;
        if (res.headers['content-type']?.includes('application/json')) {
          try {
            parsed = JSON.parse(data);
          } catch (e) {
            // keep raw data
          }
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: parsed
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (body) {
      req.write(payload);
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- Starting API Verification Tests ---');
  let token = '';
  let testArtifactId = '';

  try {
    // 1. GET Root
    console.log('\n1. Verifying GET /');
    const rootRes = await request('GET', '/');
    console.log(`Status: ${rootRes.statusCode}, Response: ${rootRes.data}`);
    if (rootRes.statusCode !== 200) throw new Error('Root endpoint failed');

    // 2. POST /jwt
    console.log('\n2. Verifying POST /jwt');
    const jwtRes = await request('POST', '/jwt', { email: 'test@example.com', name: 'Tester' });
    console.log(`Status: ${jwtRes.statusCode}, Success: ${jwtRes.data.success}`);
    if (jwtRes.statusCode !== 200 || !jwtRes.data.success) throw new Error('JWT generation failed');
    token = jwtRes.data.token;
    console.log(`Token acquired: ${token.substring(0, 20)}...`);

    // 3. GET /artifacts (initial check)
    console.log('\n3. Verifying GET /artifacts');
    const getRes = await request('GET', '/artifacts');
    console.log(`Status: ${getRes.statusCode}, Count: ${getRes.data.length}`);
    console.log('Artifacts:', getRes.data.map(a => a.name));
    if (getRes.statusCode !== 200 || getRes.data.length === 0) throw new Error('GET artifacts failed');

    // 4. GET /artifacts with search query
    console.log('\n4. Verifying GET /artifacts?search=Rosetta');
    const searchRes = await request('GET', '/artifacts?search=Rosetta');
    console.log(`Status: ${searchRes.statusCode}, Count: ${searchRes.data.length}`);
    if (searchRes.statusCode !== 200 || searchRes.data[0]?.name !== 'Rosetta Stone') throw new Error('Search failed');

    // 5. POST /artifacts without token
    console.log('\n5. Verifying POST /artifacts without token (should fail)');
    const failPostRes = await request('POST', '/artifacts', {
      name: 'Excalibur',
      image: 'https://example.com/excalibur.jpg',
      type: 'Weapons',
      historicalContext: 'Legendary sword of King Arthur.',
      createdAt: '5th Century AD',
      discoveredAt: 'Unknown',
      discoveredBy: 'Arthur Pendragon',
      presentLocation: 'Lady of the Lake',
      adderName: 'Tester',
      adderEmail: 'test@example.com'
    });
    console.log(`Status: ${failPostRes.statusCode}, Message: ${failPostRes.data.message}`);
    if (failPostRes.statusCode !== 401) throw new Error('Unauthorized check failed');

    // 6. POST /artifacts with correct token
    console.log('\n6. Verifying POST /artifacts with token');
    const successPostRes = await request('POST', '/artifacts', {
      name: 'Excalibur',
      image: 'https://example.com/excalibur.jpg',
      type: 'Weapons',
      historicalContext: 'Legendary sword of King Arthur.',
      createdAt: '5th Century AD',
      discoveredAt: 'Unknown',
      discoveredBy: 'Arthur Pendragon',
      presentLocation: 'Lady of the Lake',
      adderName: 'Tester',
      adderEmail: 'test@example.com'
    }, { 'Authorization': `Bearer ${token}` });
    console.log(`Status: ${successPostRes.statusCode}, Success: ${successPostRes.data.success}`);
    if (successPostRes.statusCode !== 201 || !successPostRes.data.success) throw new Error('Artifact creation failed');
    testArtifactId = successPostRes.data.result.insertedId;
    console.log(`Created artifact ID: ${testArtifactId}`);

    // 7. GET /artifacts (all check)
    console.log('\n7. Verifying GET /artifacts again');
    const allRes = await request('GET', '/artifacts');
    console.log(`Status: ${allRes.statusCode}, Count: ${allRes.data.length}`);
    console.log('Artifacts:', allRes.data.map(a => a.name));
    if (allRes.data.length !== 2) throw new Error('Count mismatch after addition');

    // 8. GET /artifacts/:id
    console.log(`\n8. Verifying GET /artifacts/${testArtifactId}?email=test@example.com`);
    const singleRes = await request('GET', `/artifacts/${testArtifactId}?email=test@example.com`);
    console.log(`Status: ${singleRes.statusCode}, Name: ${singleRes.data.name}, LikeCount: ${singleRes.data.likeCount}, isLiked: ${singleRes.data.isLiked}`);
    if (singleRes.statusCode !== 200 || singleRes.data.isLiked !== false) throw new Error('Single artifact retrieval failed');

    // 9. POST /artifacts/:id/like
    console.log(`\n9. Verifying POST /artifacts/${testArtifactId}/like`);
    const likeRes = await request('POST', `/artifacts/${testArtifactId}/like`, null, { 'Authorization': `Bearer ${token}` });
    console.log(`Status: ${likeRes.statusCode}, Liked: ${likeRes.data.liked}, LikeCount: ${likeRes.data.likeCount}`);
    if (likeRes.statusCode !== 200 || likeRes.data.liked !== true || likeRes.data.likeCount !== 1) throw new Error('Like toggle failed');

    // 10. GET /artifacts/:id (liked check)
    console.log(`\n10. Verifying GET /artifacts/${testArtifactId}?email=test@example.com (after liking)`);
    const singleLikedRes = await request('GET', `/artifacts/${testArtifactId}?email=test@example.com`);
    console.log(`Status: ${singleLikedRes.statusCode}, isLiked: ${singleLikedRes.data.isLiked}, LikeCount: ${singleLikedRes.data.likeCount}`);
    if (singleLikedRes.statusCode !== 200 || singleLikedRes.data.isLiked !== true) throw new Error('Like status did not update');

    // 11. GET /liked-artifacts
    console.log('\n11. Verifying GET /liked-artifacts');
    const likedListRes = await request('GET', '/liked-artifacts', null, { 'Authorization': `Bearer ${token}` });
    console.log(`Status: ${likedListRes.statusCode}, Count: ${likedListRes.data.length}`);
    console.log('Liked items:', likedListRes.data.map(a => a.name));
    if (likedListRes.statusCode !== 200 || likedListRes.data.length !== 1 || likedListRes.data[0].name !== 'Excalibur') throw new Error('Liked list verification failed');

    // 12. GET /my-artifacts
    console.log('\n12. Verifying GET /my-artifacts');
    const myListRes = await request('GET', '/my-artifacts', null, { 'Authorization': `Bearer ${token}` });
    console.log(`Status: ${myListRes.statusCode}, Count: ${myListRes.data.length}`);
    console.log('My items:', myListRes.data.map(a => a.name));
    if (myListRes.statusCode !== 200 || myListRes.data.length !== 1 || myListRes.data[0].name !== 'Excalibur') throw new Error('My artifacts list failed');

    // 13. PUT /artifacts/:id (Update)
    console.log(`\n13. Verifying PUT /artifacts/${testArtifactId}`);
    const updateRes = await request('PUT', `/artifacts/${testArtifactId}`, {
      name: 'Excalibur (Forged anew)',
      image: 'https://example.com/excalibur_new.jpg',
      type: 'Weapons',
      historicalContext: 'Reforged legendary sword.',
      createdAt: '5th Century AD',
      discoveredAt: '1200',
      discoveredBy: 'Arthur',
      presentLocation: 'Avalon'
    }, { 'Authorization': `Bearer ${token}` });
    console.log(`Status: ${updateRes.statusCode}, Success: ${updateRes.data.success}`);
    if (updateRes.statusCode !== 200) throw new Error('Artifact update failed');

    // Get again to check update and if likeCount is unaffected
    const checkedUpdateRes = await request('GET', `/artifacts/${testArtifactId}`);
    console.log(`Updated details - Name: "${checkedUpdateRes.data.name}", Present Location: "${checkedUpdateRes.data.presentLocation}", LikeCount: ${checkedUpdateRes.data.likeCount}`);
    if (checkedUpdateRes.data.name !== 'Excalibur (Forged anew)' || checkedUpdateRes.data.likeCount !== 1) {
      throw new Error('Update safety checks failed: Name not updated or likeCount altered');
    }

    // 14. POST /artifacts/:id/like (Dislike toggle)
    console.log(`\n14. Verifying POST /artifacts/${testArtifactId}/like (toggle to Dislike)`);
    const dislikeRes = await request('POST', `/artifacts/${testArtifactId}/like`, null, { 'Authorization': `Bearer ${token}` });
    console.log(`Status: ${dislikeRes.statusCode}, Liked: ${dislikeRes.data.liked}, LikeCount: ${dislikeRes.data.likeCount}`);
    if (dislikeRes.statusCode !== 200 || dislikeRes.data.liked !== false || dislikeRes.data.likeCount !== 0) throw new Error('Dislike toggle failed');

    // 15. DELETE /artifacts/:id
    console.log(`\n15. Verifying DELETE /artifacts/${testArtifactId}`);
    const deleteRes = await request('DELETE', `/artifacts/${testArtifactId}`, null, { 'Authorization': `Bearer ${token}` });
    console.log(`Status: ${deleteRes.statusCode}, Success: ${deleteRes.data.success}`);
    if (deleteRes.statusCode !== 200) throw new Error('Artifact deletion failed');

    // 16. GET /artifacts (final verify)
    console.log('\n16. Verifying GET /artifacts after deletion');
    const finalGetRes = await request('GET', '/artifacts');
    console.log(`Status: ${finalGetRes.statusCode}, Count: ${finalGetRes.data.length}`);
    if (finalGetRes.data.length !== 1) throw new Error('Artifact was not deleted correctly');

    console.log('\n=========================================');
    console.log('SUCCESS: All 16 API endpoints verified!');
    console.log('=========================================');
    process.exit(0);

  } catch (err) {
    console.error('\n❌ TEST FAILED:', err.message);
    process.exit(1);
  }
}

// Wait briefly for server connection logic if needed
setTimeout(runTests, 1000);
