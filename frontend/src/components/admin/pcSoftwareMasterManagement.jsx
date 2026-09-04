import React, { useState, useEffect } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { 
  FiPlus as Plus, 
  FiEdit as Edit, 
  FiTrash2 as Trash2, 
  FiEye as Eye, 
  FiX as X, 
  FiUpload as Upload, 
  FiVideo as Video, 
  FiImage as ImageIcon,
  FiSearch as Search,
  FiChevronLeft as ChevronLeft,
  FiChevronRight as ChevronRight,
  FiDownload as Download,
  FiRefreshCw as RefreshCw
} from 'react-icons/fi';
import { format } from 'date-fns';

const API_BASE_URL = import.meta.env.VITE_API_URL;
const BASE_URL = import.meta.env.VITE_BASE_URL;

const SoftwareMasterManagement = () => {
  const [software, setSoftware] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedSoftware, setSelectedSoftware] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('create'); // create, edit, view
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [formData, setFormData] = useState({
    software_name: '',
    software_icon: null,
    software_video: null
  });
  const [previewIcon, setPreviewIcon] = useState(null);
  const [previewVideo, setPreviewVideo] = useState(null);

  // Fetch software data
  const fetchSoftware = async (page = 1) => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_BASE_URL}/software-master?page=${page}&limit=9`);
      if (response.data.success) {
        setSoftware(response.data.data);
        setTotalPages(response.data.pagination.totalPages);
        setCurrentPage(page);
      }
    } catch (error) {
      toast.error('Failed to fetch software data');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSoftware();
  }, []);

  // Handle form input changes
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // Handle file changes
  const handleFileChange = (e, type) => {
    const file = e.target.files[0];
    if (file) {
      setFormData(prev => ({ ...prev, [type]: file }));
      
      // Create preview URLs
      if (type === 'software_icon') {
        const reader = new FileReader();
        reader.onloadend = () => {
          setPreviewIcon(reader.result);
        };
        reader.readAsDataURL(file);
      } else if (type === 'software_video') {
        const url = URL.createObjectURL(file);
        setPreviewVideo(url);
      }
    }
  };

  // Create software
  const handleCreate = async (e) => {
    e.preventDefault();
    const formDataToSend = new FormData();
    formDataToSend.append('software_name', formData.software_name);
    if (formData.software_icon) {
      formDataToSend.append('software_icon', formData.software_icon);
    }
    if (formData.software_video) {
      formDataToSend.append('software_video', formData.software_video);
    }

    try {
      const response = await axios.post(`${API_BASE_URL}/software-master`, formDataToSend, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      if (response.data.success) {
        toast.success('Software created successfully');
        closeModal();
        fetchSoftware(currentPage);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to create software');
    }
  };

  // Update software
  const handleUpdate = async (e) => {
    e.preventDefault();
    const formDataToSend = new FormData();
    formDataToSend.append('software_name', formData.software_name);
    if (formData.software_icon && typeof formData.software_icon !== 'string') {
      formDataToSend.append('software_icon', formData.software_icon);
    }
    if (formData.software_video && typeof formData.software_video !== 'string') {
      formDataToSend.append('software_video', formData.software_video);
    }

    try {
      const response = await axios.put(`${API_BASE_URL}/software-master/${selectedSoftware.software_id}`, formDataToSend, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      if (response.data.success) {
        toast.success('Software updated successfully');
        closeModal();
        fetchSoftware(currentPage);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update software');
    }
  };

  // Delete software (soft delete)
  const handleDelete = async (id, name) => {
    if (window.confirm(`Are you sure you want to delete "${name}"?`)) {
      try {
        const response = await axios.delete(`${API_BASE_URL}/software-master/${id}`);
        if (response.data.success) {
          toast.success('Software deleted successfully');
          fetchSoftware(currentPage);
        }
      } catch {
        toast.error('Failed to delete software');
      }
    }
  };

  // Open modal for create/edit/view
  const openModal = (mode, software = null) => {
    setModalMode(mode);
    if (software) {
      setSelectedSoftware(software);
      setFormData({
        software_name: software.software_name,
        software_icon: software.software_icon,
        software_video: software.software_video
      });
      if (software.software_icon) {
        setPreviewIcon(`${BASE_URL}${software.software_icon}`);
      }
      if (software.software_video) {
        setPreviewVideo(`${BASE_URL}${software.software_video}`);
      }
    } else {
      setFormData({
        software_name: '',
        software_icon: null,
        software_video: null
      });
      setPreviewIcon(null);
      setPreviewVideo(null);
    }
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedSoftware(null);
    setPreviewIcon(null);
    setPreviewVideo(null);
    setFormData({
      software_name: '',
      software_icon: null,
      software_video: null
    });
  };

  // Filter software based on search
  const filteredSoftware = software.filter(item =>
    item.software_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-gray-900 to-black">
      {/* Header Section */}
      <div className="bg-gradient-to-r from-red-600 to-red-800 shadow-2xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-4xl font-bold text-white mb-2">Software Management</h1>
              <p className="text-red-100">Manage your software applications with ease</p>
            </div>
            <button
              onClick={() => openModal('create')}
              className="bg-black hover:bg-gray-900 text-white px-6 py-3 rounded-lg flex items-center gap-2 transition-all transform hover:scale-105 shadow-lg"
            >
              <Plus size={20} />
              Add New Software
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Search and Filter Bar */}
        <div className="mb-8 flex gap-4 items-center">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="Search software..."
              aria-label="Search software"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-gray-900 border border-red-500/30 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-red-500 transition-colors"
            />
          </div>
          <button
            onClick={() => fetchSoftware(currentPage)}
            aria-label="Refresh the software list"
            title="Refresh"
            className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-3 rounded-lg transition-colors"
          >
            <RefreshCw size={20} />
          </button>
        </div>

        {/* Software Grid */}
        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-500"></div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredSoftware.map((item) => (
                <div
                  key={item.software_id}
                  className="bg-gray-900/50 backdrop-blur-sm border border-red-500/20 rounded-xl overflow-hidden hover:border-red-500/40 transition-all hover:transform hover:scale-105 group"
                >
                  {/* Icon Section */}
                  <div className="relative h-48 bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center">
                    {item.software_icon ? (
                      <img
                        src={`${BASE_URL}${item.software_icon}`}
                        alt={item.software_name}
                        className="h-32 w-32 object-cover rounded-lg shadow-2xl"
                      />
                    ) : (
                      <div className="h-32 w-32 bg-red-600/20 rounded-lg flex items-center justify-center">
                        <ImageIcon size={48} className="text-red-500" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <button
                        onClick={() => openModal('view', item)}
                        aria-label={`View ${item.software_name}`}
                        title="View"
                        className="bg-red-600 hover:bg-red-700 p-2 rounded-full transition-colors"
                      >
                        <Eye size={20} />
                      </button>
                      <button
                        onClick={() => openModal('edit', item)}
                        aria-label={`Edit ${item.software_name}`}
                        title="Edit"
                        className="bg-blue-600 hover:bg-blue-700 p-2 rounded-full transition-colors"
                      >
                        <Edit size={20} />
                      </button>
                      <button
                        onClick={() => handleDelete(item.software_id, item.software_name)}
                        aria-label={`Delete ${item.software_name}`}
                        title="Delete"
                        className="bg-red-600 hover:bg-red-700 p-2 rounded-full transition-colors"
                      >
                        <Trash2 size={20} />
                      </button>
                    </div>
                  </div>

                  {/* Content Section */}
                  <div className="p-6">
                    <h3 className="text-xl font-semibold text-white mb-2">{item.software_name}</h3>
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      <span>Created: {format(new Date(item.created_at), 'MMM dd, yyyy')}</span>
                    </div>
                    {item.software_video && (
                      <div className="mt-3 flex items-center gap-2 text-red-400">
                        <Video size={16} />
                        <span className="text-sm">Has Demo Video</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex justify-center items-center gap-2 mt-8">
                <button
                  onClick={() => fetchSoftware(currentPage - 1)}
                  disabled={currentPage === 1}
                  aria-label="Previous page"
                  title="Previous page"
                  className="px-4 py-2 bg-gray-800 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-700 transition-colors"
                >
                  <ChevronLeft size={20} />
                </button>
                <span className="px-4 py-2 bg-red-600 text-white rounded-lg">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => fetchSoftware(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  aria-label="Next page"
                  title="Next page"
                  className="px-4 py-2 bg-gray-800 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-700 transition-colors"
                >
                  <ChevronRight size={20} />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-red-500/20">
            <div className="sticky top-0 bg-gray-900 border-b border-red-500/20 p-6 flex justify-between items-center">
              <h2 className="text-2xl font-bold text-white">
                {modalMode === 'create' && 'Add New Software'}
                {modalMode === 'edit' && 'Edit Software'}
                {modalMode === 'view' && 'Software Details'}
              </h2>
              <button
                onClick={closeModal}
                aria-label="Close"
                title="Close"
                className="text-gray-400 hover:text-white transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            <form onSubmit={modalMode === 'create' ? handleCreate : handleUpdate} className="p-6 space-y-6">
              {/* Software Name */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Software Name *
                </label>
                <input
                  type="text"
                  name="software_name"
                  value={formData.software_name}
                  onChange={handleInputChange}
                  required
                  disabled={modalMode === 'view'}
                  className="w-full px-4 py-2 bg-gray-800 border border-red-500/30 rounded-lg text-white focus:outline-none focus:border-red-500 disabled:opacity-50"
                  placeholder="Enter software name"
                />
              </div>

              {/* Software Icon Upload */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Software Icon
                </label>
                <div className="flex items-center gap-4">
                  {previewIcon && (
                    <div className="relative">
                      <img
                        src={previewIcon}
                        alt="Preview"
                        className="h-20 w-20 object-cover rounded-lg border border-red-500"
                      />
                    </div>
                  )}
                  {modalMode !== 'view' && (
                    <label className="flex-1 cursor-pointer">
                      <div className="bg-gray-800 border-2 border-dashed border-red-500/30 rounded-lg p-4 text-center hover:border-red-500 transition-colors">
                        <Upload className="mx-auto mb-2 text-gray-400" size={24} />
                        <p className="text-sm text-gray-400">Click to upload icon</p>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => handleFileChange(e, 'software_icon')}
                          className="hidden"
                        />
                      </div>
                    </label>
                  )}
                </div>
              </div>

              {/* Software Video Upload */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Demo Video
                </label>
                {previewVideo && (
                  <video
                    src={previewVideo}
                    controls
                    className="w-full rounded-lg mb-4 border border-red-500/30"
                  />
                )}
                {modalMode !== 'view' && (
                  <label className="cursor-pointer">
                    <div className="bg-gray-800 border-2 border-dashed border-red-500/30 rounded-lg p-4 text-center hover:border-red-500 transition-colors">
                      <Video className="mx-auto mb-2 text-gray-400" size={24} />
                      <p className="text-sm text-gray-400">Click to upload video (MP4, MOV, AVI)</p>
                      <input
                        type="file"
                        accept="video/*"
                        onChange={(e) => handleFileChange(e, 'software_video')}
                        className="hidden"
                      />
                    </div>
                  </label>
                )}
              </div>

              {/* View Mode Additional Info */}
              {modalMode === 'view' && selectedSoftware && (
                <div className="bg-gray-800 rounded-lg p-4 space-y-2">
                  <p className="text-gray-300">
                    <span className="font-semibold">Created:</span>{' '}
                    {format(new Date(selectedSoftware.created_at), 'PPPppp')}
                  </p>
                  <p className="text-gray-300">
                    <span className="font-semibold">Last Updated:</span>{' '}
                    {format(new Date(selectedSoftware.updated_at), 'PPPppp')}
                  </p>
                  <p className="text-gray-300">
                    <span className="font-semibold">Status:</span>{' '}
                    <span className={selectedSoftware.is_active ? 'text-green-500' : 'text-red-500'}>
                      {selectedSoftware.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </p>
                </div>
              )}

              {/* Action Buttons */}
              {modalMode !== 'view' && (
                <div className="flex gap-3 pt-4">
                  <button
                    type="submit"
                    className="flex-1 bg-gradient-to-r from-red-600 to-red-700 text-white py-3 rounded-lg font-semibold hover:from-red-700 hover:to-red-800 transition-all transform hover:scale-105"
                  >
                    {modalMode === 'create' ? 'Create Software' : 'Update Software'}
                  </button>
                  <button
                    type="button"
                    onClick={closeModal}
                    className="flex-1 bg-gray-800 text-white py-3 rounded-lg font-semibold hover:bg-gray-700 transition-all"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {modalMode === 'view' && (
                <button
                  type="button"
                  onClick={closeModal}
                  className="w-full bg-gray-800 text-white py-3 rounded-lg font-semibold hover:bg-gray-700 transition-all"
                >
                  Close
                </button>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SoftwareMasterManagement;